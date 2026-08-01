package expo.modules.videoexporter

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val TIMEOUT_US = 10_000L
private const val AAC_BITRATE = 128_000

/**
 * Pre-renders the export's entire audio track: per clip, decode → channel-mix
 * → retime (resample for pitch-shift, WSOLA for pitch-preserve) → one shared
 * AAC encoder, collected as packets the engine muxes after the video pass.
 *
 * The whole timeline is rendered as ONE continuous PCM stream — clips that
 * can't contribute (muted, no audio track, decode failure) contribute real
 * silence samples of exactly their output duration. That's deliberate:
 * MediaCodec AAC encoders commonly regenerate timestamps from sample count
 * and ignore input pts, so alignment by sample continuity is trustworthy
 * where alignment by timestamp gaps is not. Each contributing clip is also
 * padded/truncated to exactly its output duration, so retiming error can't
 * accumulate across cuts.
 */
object AudioRenderer {
  class Packet(val data: ByteArray, val ptsUs: Long, val flags: Int)
  class Result(val format: MediaFormat, val packets: List<Packet>)

  fun render(clips: List<ExportClip>): Result? {
    // Output rate/channels come from the first clip that has any audio.
    var outRate = 0
    var outCh = 0
    for (clip in clips) {
      val ex = MediaExtractor().apply { setDataSource(clip.uri) }
      val t = findAudioTrack(ex)
      if (t >= 0) {
        val f = ex.getTrackFormat(t)
        outRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        outCh = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceIn(1, 2)
      }
      ex.release()
      if (outRate > 0) break
    }
    if (outRate <= 0) return null // nothing anywhere to render

    val encFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, outRate, outCh).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()

    val packets = mutableListOf<Packet>()
    var outFormat: MediaFormat? = null
    var framesFed = 0L // per-channel frames pushed into the encoder
    val pendingPcm = ArrayDeque<Short>()

    fun drainEncoder(untilEos: Boolean) {
      val info = MediaCodec.BufferInfo()
      while (true) {
        val idx = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
        when {
          idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> outFormat = encoder.outputFormat
          idx >= 0 -> {
            val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
            if (!isConfig && info.size > 0) {
              val buf = encoder.getOutputBuffer(idx)!!
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              val bytes = ByteArray(info.size)
              buf.get(bytes)
              packets.add(Packet(bytes, info.presentationTimeUs, info.flags))
            }
            encoder.releaseOutputBuffer(idx, false)
            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return
          }
          else -> if (!untilEos) return
        }
      }
    }

    /** Moves pending PCM into however many encoder input buffers it fills. */
    fun feedEncoder(eos: Boolean) {
      while (pendingPcm.size > 0 || eos) {
        val idx = encoder.dequeueInputBuffer(TIMEOUT_US)
        if (idx < 0) {
          drainEncoder(false)
          if (!eos) return
          continue
        }
        val buf = encoder.getInputBuffer(idx)!!
        buf.order(ByteOrder.nativeOrder())
        val capShorts = buf.capacity() / 2
        if (pendingPcm.isEmpty() && eos) {
          encoder.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          drainEncoder(true)
          return
        }
        // Feed whole frames only — splitting a frame across buffers can
        // confuse some AAC encoders' channel alignment.
        val maxShorts = capShorts - (capShorts % outCh)
        var n = 0
        while (n < maxShorts && pendingPcm.isNotEmpty()) {
          buf.putShort(pendingPcm.removeFirst())
          n++
        }
        val ptsUs = framesFed * 1_000_000L / outRate
        encoder.queueInputBuffer(idx, 0, n * 2, ptsUs, 0)
        framesFed += n / outCh
        drainEncoder(false)
        if (pendingPcm.isEmpty() && !eos) return
      }
    }

    val chunkOut = mutableListOf<Short>()
    fun flushChunk() {
      if (chunkOut.isEmpty()) return
      for (s in chunkOut) pendingPcm.addLast(s)
      chunkOut.clear()
      feedEncoder(false)
    }

    try {
      for (clip in clips) {
        val expectedFrames = clip.outputDurationUs() * outRate / 1_000_000L

        val contributed = if (clip.muted) 0L else try {
          decodeAndRetime(clip, outRate, outCh, expectedFrames, chunkOut, ::flushChunk)
        } catch (e: Exception) {
          0L // this clip becomes silence; the rest of the track is unaffected
        }

        // Pad to exactly the clip's output duration so the next cut can't drift.
        var pad = expectedFrames - contributed
        while (pad > 0) {
          val block = minOf(pad, 8192L).toInt()
          repeat(block * outCh) { chunkOut.add(0) }
          flushChunk()
          pad -= block
        }
      }
      feedEncoder(true)
    } finally {
      try { encoder.stop() } catch (e: Exception) { }
      encoder.release()
    }

    val fmt = outFormat ?: return null
    if (packets.isEmpty()) return null
    return Result(fmt, packets)
  }

  /**
   * Decodes one clip's audio between its trim points, converts channels,
   * retimes, and streams shorts out via chunkOut/flush. Returns per-channel
   * frames emitted (capped at expectedFrames — truncation happens here so
   * padding logic upstream stays one-directional).
   */
  private fun decodeAndRetime(
    clip: ExportClip,
    outRate: Int,
    outCh: Int,
    expectedFrames: Long,
    chunkOut: MutableList<Short>,
    flush: () -> Unit
  ): Long {
    val extractor = MediaExtractor().apply { setDataSource(clip.uri) }
    val track = findAudioTrack(extractor)
    if (track < 0) {
      extractor.release()
      return 0L
    }
    extractor.selectTrack(track)
    val inFormat = extractor.getTrackFormat(track)
    val mime = inFormat.getString(MediaFormat.KEY_MIME)!!
    val trimInUs = (clip.trimIn * 1_000_000.0).toLong().coerceAtLeast(0L)
    val trimOutUs = if (clip.trimOut > clip.trimIn) (clip.trimOut * 1_000_000.0).toLong() else Long.MAX_VALUE
    extractor.seekTo(trimInUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val decoder = MediaCodec.createDecoderByType(mime)
    decoder.configure(inFormat, null, null, 0)
    decoder.start()

    // Actual decoded geometry can differ from container metadata; read it
    // from the decoder's own output format when it announces one.
    var srcRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var srcCh = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

    var stretcher: WsolaStretcher? = null
    var resampler: LinearResampler? = null
    fun rebuildChain() {
      val speed = clip.speed.coerceAtLeast(0.01)
      if (speed != 1.0 && clip.preservePitch) {
        stretcher = WsolaStretcher(outCh, srcRate, speed)
        resampler = if (srcRate != outRate) LinearResampler(outCh, srcRate.toDouble() / outRate) else null
      } else {
        stretcher = null
        val ratio = speed * srcRate.toDouble() / outRate
        resampler = if (ratio != 1.0) LinearResampler(outCh, ratio) else null
      }
    }
    rebuildChain()

    var emitted = 0L
    val stage = mutableListOf<Short>()
    fun process(pcm: ShortArray, last: Boolean) {
      val mixed = ChannelMixer.convert(pcm, srcCh, outCh)
      stage.clear()
      val st = stretcher
      val rs = resampler
      if (st != null) {
        st.push(mixed, stage)
        if (last) st.flush(stage)
        if (rs != null) {
          val mid = stage.toShortArray()
          stage.clear()
          rs.push(mid, stage)
          if (last) rs.flush(stage)
        }
      } else if (rs != null) {
        rs.push(mixed, stage)
        if (last) rs.flush(stage)
      } else {
        for (s in mixed) stage.add(s)
      }
      // Truncate at the clip's exact output length.
      var i = 0
      while (i + outCh <= stage.size && emitted < expectedFrames) {
        for (c in 0 until outCh) chunkOut.add(stage[i + c])
        i += outCh
        emitted++
      }
      flush()
    }

    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone && emitted < expectedFrames) {
        if (!inputDone) {
          val inIdx = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIdx >= 0) {
            val buf = decoder.getInputBuffer(inIdx)!!
            val size = extractor.readSampleData(buf, 0)
            if (size < 0 || extractor.sampleTime > trimOutUs) {
              decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outIdx = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
        when {
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val f = decoder.outputFormat
            srcRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            srcCh = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            // Anything other than 16-bit PCM (some devices emit float) would
            // corrupt the short-based chain — bail to the silence fallback.
            if (f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
              f.getInteger(MediaFormat.KEY_PCM_ENCODING) != android.media.AudioFormat.ENCODING_PCM_16BIT
            ) {
              throw IllegalStateException("Non-16-bit PCM output")
            }
            rebuildChain()
          }
          outIdx >= 0 -> {
            val isEos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            if (info.size > 0 && info.presentationTimeUs >= trimInUs) {
              val buf = decoder.getOutputBuffer(outIdx)!!
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              val shorts = ShortArray(info.size / 2)
              buf.order(ByteOrder.nativeOrder()).asShortBuffer().get(shorts)
              process(shorts, isEos)
            } else if (isEos) {
              process(ShortArray(0), true)
            }
            decoder.releaseOutputBuffer(outIdx, false)
            if (isEos) outputDone = true
          }
        }
      }
    } finally {
      try { decoder.stop() } catch (e: Exception) { }
      decoder.release()
      extractor.release()
    }
    return emitted
  }

  private fun findAudioTrack(extractor: MediaExtractor): Int {
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) return i
    }
    return -1
  }
}
