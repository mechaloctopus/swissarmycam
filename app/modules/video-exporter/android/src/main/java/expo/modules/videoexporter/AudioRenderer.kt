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

  /**
   * A decoded audio track waiting to be summed into the timeline, already at
   * the output rate and channel count so mixing is a plain add.
   */
  private class MixSource(
    val pcm: ShortArray,
    val startFrame: Long,
    val frames: Long,
    val gain: Float,
    val fadeInFrames: Long,
    val fadeOutFrames: Long
  ) {
    fun gainAt(f: Long): Float {
      var g = gain
      if (fadeInFrames > 0 && f < fadeInFrames) g *= f.toFloat() / fadeInFrames
      val fromEnd = frames - 1 - f
      if (fadeOutFrames > 0 && fromEnd < fadeOutFrames) {
        g *= (fromEnd.toFloat() / fadeOutFrames).coerceAtLeast(0f)
      }
      return g
    }
  }

  fun render(clips: List<ExportClip>, audios: List<ExportAudio> = emptyList()): Result? {
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
    // A silent video with a music track still needs a track rendered, so fall
    // back to the first audio layer's geometry when no clip has any sound.
    if (outRate <= 0) {
      for (a in audios) {
        val ex = MediaExtractor().apply { setDataSource(a.uri) }
        val t = findAudioTrack(ex)
        if (t >= 0) {
          val f = ex.getTrackFormat(t)
          outRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          outCh = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceIn(1, 2)
        }
        ex.release()
        if (outRate > 0) break
      }
    }
    if (outRate <= 0) return null // nothing anywhere to render

    val sources = audios.mapNotNull { decodeSource(it, outRate, outCh) }

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
    // Global frame index of the start of chunkOut. Every sample in the export
    // — decoded clip audio and synthesized padding alike — passes through here,
    // so mixing at this one point covers the whole timeline including the gaps,
    // and stays aligned by sample count rather than timestamps.
    var mixFrame = 0L
    fun flushChunk() {
      if (chunkOut.isEmpty()) return
      mixInto(chunkOut, mixFrame, outCh, sources)
      mixFrame += chunkOut.size / outCh
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

  /** Sums each overlapping audio track into this chunk of timeline PCM. */
  private fun mixInto(chunk: MutableList<Short>, chunkStartFrame: Long, outCh: Int, sources: List<MixSource>) {
    if (sources.isEmpty()) return
    val frames = (chunk.size / outCh).toLong()
    for (src in sources) {
      val from = maxOf(chunkStartFrame, src.startFrame)
      val to = minOf(chunkStartFrame + frames, src.startFrame + src.frames)
      if (to <= from) continue
      for (f in from until to) {
        val g = src.gainAt(f - src.startFrame)
        if (g <= 0f) continue
        val ci = ((f - chunkStartFrame) * outCh).toInt()
        val si = ((f - src.startFrame) * outCh).toInt()
        for (c in 0 until outCh) {
          // Hard clip: gain is the user's to control, and silently attenuating
          // the whole mix to avoid it would be a stranger surprise than
          // clipping a track they pushed too loud.
          val sum = chunk[ci + c].toInt() + (src.pcm[si + c] * g).toInt()
          chunk[ci + c] = sum.coerceIn(-32768, 32767).toShort()
        }
      }
    }
  }

  /**
   * Decodes an imported track to PCM at the output geometry, by running it
   * through the very same decode path clips use at speed 1.0 — that path
   * already channel-converts and resamples, so there is no second decoder to
   * keep in sync with this one.
   */
  private fun decodeSource(a: ExportAudio, outRate: Int, outCh: Int): MixSource? {
    val span = (a.trimOut - a.trimIn).coerceAtLeast(0.0)
    if (span <= 0.0) return null
    val expected = (span * outRate).toLong()
    if (expected <= 0L) return null

    val collected = mutableListOf<Short>()
    val asClip = ExportClip(a.uri, a.trimIn, a.trimOut, 1.0, false, false, "none", 0.0)
    val emitted = try {
      decodeAndRetime(asClip, outRate, outCh, expected, collected) { }
    } catch (e: Exception) {
      0L // a track that will not decode is dropped; the export still succeeds
    }
    if (emitted <= 0L || collected.isEmpty()) return null

    return MixSource(
      pcm = collected.toShortArray(),
      startFrame = (a.tIn * outRate).toLong().coerceAtLeast(0L),
      frames = (collected.size / outCh).toLong(),
      gain = a.gain,
      fadeInFrames = (a.fadeIn * outRate).toLong(),
      fadeOutFrames = (a.fadeOut * outRate).toLong()
    )
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
