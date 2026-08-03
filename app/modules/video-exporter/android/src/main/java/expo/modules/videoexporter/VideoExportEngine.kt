package expo.modules.videoexporter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.GLES20
import android.opengl.GLUtils
import android.opengl.Matrix
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer

private const val TIMEOUT_US = 10_000L
private const val FRAME_WAIT_TIMEOUT_MS = 2_500L

/**
 * Bakes the Studio timeline into one MP4: a sequence of clips, each decoded
 * with MediaCodec into a SurfaceTexture (external OES texture), composited
 * with every overlay layer's interpolated pose for that frame via GLES, and
 * encoded through a single MediaCodec encoder + muxer that stay open for the
 * whole run so the output is one continuous stream.
 *
 * This is the standard MediaCodec decode -> GLES composite -> encode shape
 * (as in Android's own CTS DecodeEditEncodeTest and the Grafika samples) —
 * not a screen capture: every output frame is a real re-encode.
 */
class VideoExportEngine(private val context: Context) {

  fun export(
    outputPath: String,
    layersJson: String,
    canvasWidth: Int,
    canvasHeight: Int,
    clipsJson: String,
    audiosJson: String
  ) {
    val layers = LayerParser.parse(layersJson)
    val clips = LayerParser.parseClips(clipsJson)
    val audios = LayerParser.parseAudios(audiosJson)
    require(clips.isNotEmpty()) { "No clips to export" }

    // Output geometry comes from the first clip; later clips of a different
    // size are fitted into it (letterboxed) rather than stretched.
    val firstProbe = MediaExtractor().apply { setDataSource(clips[0].uri) }
    val firstVideoTrack = findTrack(firstProbe, "video/")
    require(firstVideoTrack >= 0) { "No video track in the first clip" }
    val firstFormat = firstProbe.getTrackFormat(firstVideoTrack)
    val outWidth = firstFormat.getInteger(MediaFormat.KEY_WIDTH)
    val outHeight = firstFormat.getInteger(MediaFormat.KEY_HEIGHT)
    firstProbe.release()

    // ---- audio strategy --------------------------------------------------
    // Probe every unmuted clip's audio format up front.
    val audioProbes = mutableListOf<MediaFormat>()
    var anyRetimed = false
    for (clip in clips) {
      if (clip.muted) continue
      if (clip.speed != 1.0) anyRetimed = true
      val probe = MediaExtractor().apply { setDataSource(clip.uri) }
      val at = findTrack(probe, "audio/")
      if (at >= 0) audioProbes.add(probe.getTrackFormat(at))
      probe.release()
    }
    // Lossless passthrough when nothing needs retiming and every source's
    // format can legally share one muxer track. Otherwise pre-render the
    // whole audio timeline (decode → retime → AAC re-encode) — that path
    // also fixes what used to be silent gaps from mixed-format 1x clips.
    // A pre-render failure degrades to a silent export, never a failed one.
    val passthroughOk = audioProbes.isNotEmpty() && !anyRetimed &&
      audioProbes.all { audioFormatMatches(it, audioProbes[0]) }
    val preRendered: AudioRenderer.Result? = if (audioProbes.isEmpty() || passthroughOk) null else try {
      AudioRenderer.render(clips, audios)
    } catch (e: Exception) {
      null
    }
    val audioFormatForMuxer: MediaFormat? = when {
      passthroughOk -> audioProbes[0]
      else -> preRendered?.format
    }

    val bitRate = (outWidth * outHeight * 4).coerceAtLeast(4_000_000)
    val outputFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, outWidth, outHeight).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val encoderInputSurface = encoder.createInputSurface()
    encoder.start()

    val eglCore = EglCore()
    val windowSurface = WindowSurface(eglCore, encoderInputSurface)
    windowSurface.makeCurrent()

    val videoProgram = TextureProgram(isExternal = true)
    val overlayProgram = TextureProgram(isExternal = false)
    val chromaProgram = ChromaKeyProgram(isExternal = true)
    // Stills that opt into a key go through the 2D variant of the same shader.
    val stillChromaProgram = ChromaKeyProgram(isExternal = false)
    val oesTextureId = videoProgram.createTexture()

    // A 1x1 black texture, stretched over the frame to dip transitions through
    // black. Cheaper and simpler than a dedicated solid-colour shader.
    val blackTexId = overlayProgram.createTexture()
    val blackBmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply { setPixel(0, 0, android.graphics.Color.BLACK) }
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, blackTexId)
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, blackBmp, 0)
    blackBmp.recycle()

    val glThread = HandlerThread("LensiiVideoExportGL").apply { start() }
    val glHandler = Handler(glThread.looper)
    val frameWaiter = FrameWaiter()
    val surfaceTexture = SurfaceTexture(oesTextureId)
    surfaceTexture.setDefaultBufferSize(outWidth, outHeight)
    surfaceTexture.setOnFrameAvailableListener(frameWaiter, glHandler)
    val decoderSurface = Surface(surfaceTexture)

    // Still layers' bitmaps are uploaded once and reused across every clip.
    data class Overlay(val layer: ExportLayer, val texId: Int, val naturalW: Float, val naturalH: Float, val layoutW: Float, val layoutH: Float)
    val overlays = layers.filter { it.kind != "video" }.map { layer ->
      val bmp = LayerBitmapFactory.build(context, layer)
      val texId = overlayProgram.createTexture()
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
      GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
      val (natW, natH) = LayerBitmapFactory.naturalSize(layer, bmp)
      val (layoutW, layoutH) = LayerBitmapFactory.layoutSize(layer, Pair(natW, natH))
      bmp.recycle()
      Overlay(layer, texId, natW, natH, layoutW, layoutH)
    }

    // Each video overlay layer gets its own independent decode pipeline.
    data class VideoOverlay(val layer: ExportLayer, val decoder: OverlayVideoDecoder, val naturalW: Float, val naturalH: Float)
    val videoOverlays = layers.filter { it.kind == "video" && it.uri != null }.mapNotNull { layer ->
      try {
        val texId = chromaProgram.createTexture()
        val dec = OverlayVideoDecoder(layer.uri!!.removePrefix("file://"), glHandler, texId)
        val (natW, natH) = videoLayerNaturalSize()
        VideoOverlay(layer, dec, natW, natH)
      } catch (e: Exception) {
        null // A broken overlay clip shouldn't fail the whole export.
      }
    }

    // Maps the preview canvas (contentFit="contain") onto output pixels.
    val containScale = (minOf(canvasWidth.toFloat() / outWidth, canvasHeight.toFloat() / outHeight))
      .let { if (it.isNaN() || it <= 0f) 1f else it }
    val offsetX = (canvasWidth - outWidth * containScale) / 2f
    val offsetY = (canvasHeight - outHeight * containScale) / 2f

    fun modelMatrixFor(t: ExportKeyframe, layoutW: Float, layoutH: Float, naturalW: Float, naturalH: Float): FloatArray {
      val anchorCanvasX = t.x.toFloat() + layoutW / 2f
      val anchorCanvasY = t.y.toFloat() + layoutH / 2f
      val anchorVideoX = (anchorCanvasX - offsetX) / containScale
      val anchorVideoY = (anchorCanvasY - offsetY) / containScale
      val quadW = (naturalW / containScale) * t.scale.toFloat()
      val quadH = (naturalH / containScale) * t.scale.toFloat()

      val ndcX = (anchorVideoX / outWidth) * 2f - 1f
      val ndcY = 1f - (anchorVideoY / outHeight) * 2f
      val ndcW = (quadW / outWidth) * 2f
      val ndcH = (quadH / outHeight) * 2f

      val model = FloatArray(16)
      Matrix.setIdentityM(model, 0)
      Matrix.translateM(model, 0, ndcX, ndcY, 0f)
      // Preview rotation is y-down; NDC is y-up, so negate to match.
      Matrix.rotateM(model, 0, -t.rotation.toFloat(), 0f, 0f, 1f)
      Matrix.scaleM(model, 0, ndcW / 2f, ndcH / 2f, 1f)
      return model
    }

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var muxerVideoTrack = -1
    var muxerAudioTrack = -1
    var muxerStarted = false

    val bufferInfo = MediaCodec.BufferInfo()
    val identity = FloatArray(16).also { Matrix.setIdentityM(it, 0) }
    val texMatrix = FloatArray(16)

    /** Pulls whatever the encoder has ready into the muxer. */
    fun drainEncoder(endOfStream: Boolean) {
      while (true) {
        val idx = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
          if (!endOfStream) return
          continue
        }
        if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          if (!muxerStarted) {
            muxerVideoTrack = muxer.addTrack(encoder.outputFormat)
            audioFormatForMuxer?.let { muxerAudioTrack = muxer.addTrack(it) }
            muxer.start()
            muxerStarted = true
          }
          continue
        }
        if (idx >= 0) {
          if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) bufferInfo.size = 0
          if (bufferInfo.size > 0 && muxerStarted) {
            val data = encoder.getOutputBuffer(idx)!!
            data.position(bufferInfo.offset)
            data.limit(bufferInfo.offset + bufferInfo.size)
            muxer.writeSampleData(muxerVideoTrack, data, bufferInfo)
          }
          encoder.releaseOutputBuffer(idx, false)
          if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return
        }
      }
    }

    val clipStartsUs = LongArray(clips.size)
    run {
      var acc = 0L
      for (i in clips.indices) {
        clipStartsUs[i] = acc
        acc += clips[i].outputDurationUs()
      }
    }

    try {
      for ((clipIndex, clip) in clips.withIndex()) {
        val trimInUs = (clip.trimIn * 1_000_000.0).toLong().coerceAtLeast(0L)
        val speed = clip.speed.coerceAtLeast(0.01)
        val clipStartUs = clipStartsUs[clipIndex]

        val extractor = MediaExtractor().apply { setDataSource(clip.uri) }
        val vTrack = findTrack(extractor, "video/")
        if (vTrack < 0) {
          extractor.release()
          continue // A clip with no video track is skipped rather than fatal.
        }
        extractor.selectTrack(vTrack)
        val inFormat = extractor.getTrackFormat(vTrack)
        val clipW = inFormat.getInteger(MediaFormat.KEY_WIDTH)
        val clipH = inFormat.getInteger(MediaFormat.KEY_HEIGHT)
        val mime = inFormat.getString(MediaFormat.KEY_MIME)!!
        val trimOutUs = if (clip.trimOut > clip.trimIn) (clip.trimOut * 1_000_000.0).toLong() else Long.MAX_VALUE
        extractor.seekTo(trimInUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

        // Fit this clip into the output frame preserving its aspect ratio, so
        // a mixed-resolution timeline letterboxes instead of stretching.
        val fit = minOf(outWidth.toFloat() / clipW, outHeight.toFloat() / clipH)
        val baseModel = FloatArray(16).also {
          Matrix.setIdentityM(it, 0)
          Matrix.scaleM(it, 0, (clipW * fit) / outWidth, (clipH * fit) / outHeight, 1f)
        }

        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(inFormat, decoderSurface, null, 0)
        decoder.start()

        var inputDone = false
        var thisClipDone = false

        while (!thisClipDone) {
          if (!inputDone) {
            val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
            if (inIndex >= 0) {
              val buf = decoder.getInputBuffer(inIndex)!!
              val sampleSize = extractor.readSampleData(buf, 0)
              if (sampleSize < 0 || extractor.sampleTime > trimOutUs) {
                decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }

          val outIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
          if (outIndex >= 0) {
            val isEos = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            val framePtsUs = bufferInfo.presentationTimeUs
            // Seeking lands on the sync frame before trimIn, so earlier frames
            // still decode — they just must not be drawn.
            val inRange = framePtsUs >= trimInUs && framePtsUs <= trimOutUs
            val doRender = bufferInfo.size > 0 && inRange
            decoder.releaseOutputBuffer(outIndex, doRender)

            if (doRender) {
              frameWaiter.await(FRAME_WAIT_TIMEOUT_MS)
              surfaceTexture.updateTexImage()
              surfaceTexture.getTransformMatrix(texMatrix)

              windowSurface.makeCurrent()
              GLES20.glViewport(0, 0, outWidth, outHeight)
              GLES20.glClearColor(0f, 0f, 0f, 1f)
              GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

              GLES20.glDisable(GLES20.GL_BLEND)
              videoProgram.draw(baseModel, texMatrix, oesTextureId, 1f)

              GLES20.glEnable(GLES20.GL_BLEND)
              GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)

              // Timeline (output) time: where this frame lands in the finished
              // video, which is what every layer is keyed against.
              val outPtsUs = clipStartUs + ((framePtsUs - trimInUs) / speed).toLong().coerceAtLeast(0L)
              val timelineSec = outPtsUs / 1_000_000.0

              for (ov in overlays) {
                val alpha = LayerParser.alphaAt(ov.layer, timelineSec)
                if (alpha <= 0f) continue
                val t = LayerParser.transformAt(ov.layer, timelineSec)
                val model = modelMatrixFor(t, ov.layoutW, ov.layoutH, ov.naturalW, ov.naturalH)
                val key = ov.layer.keyColor
                if (key != null) {
                  stillChromaProgram.draw(model, identity, ov.texId, key, ov.layer.threshold, ov.layer.smoothing, alpha)
                } else {
                  overlayProgram.draw(model, identity, ov.texId, alpha)
                }
              }

              for (vo in videoOverlays) {
                val alpha = LayerParser.alphaAt(vo.layer, timelineSec)
                if (alpha <= 0f) continue
                // Overlay clips play from their own start when the layer comes in.
                val overlayPtsUs = ((timelineSec - vo.layer.tIn) * 1_000_000.0).toLong().coerceAtLeast(0L)
                if (!vo.decoder.advanceTo(overlayPtsUs)) continue
                val t = LayerParser.transformAt(vo.layer, timelineSec)
                val model = modelMatrixFor(t, vo.naturalW, vo.naturalH, vo.naturalW, vo.naturalH)
                if (vo.layer.keyColor != null) {
                  chromaProgram.draw(model, vo.decoder.texMatrix, vo.decoder.texId, vo.layer.keyColor, vo.layer.threshold, vo.layer.smoothing, alpha)
                } else {
                  // Chroma off: an impossible key colour keys nothing out. The
                  // smoothing stays nonzero because smoothstep(e, e, x) with
                  // equal edges is undefined in GLSL.
                  chromaProgram.draw(model, vo.decoder.texMatrix, vo.decoder.texId, listOf(-1f, -1f, -1f), 0f, 0.001f, alpha)
                }
              }

              // Dip-through-black transitions sit on top of everything.
              val dip = LayerParser.dipAmountAt(clips, clipStartsUs, timelineSec)
              if (dip > 0f) {
                overlayProgram.draw(identity, identity, blackTexId, dip)
              }

              windowSurface.setPresentationTime(outPtsUs * 1000)
              windowSurface.swapBuffers()
              drainEncoder(false)
            }

            if (isEos) thisClipDone = true
          }
        }

        try { decoder.stop() } catch (e: Exception) { }
        decoder.release()
        extractor.release()
      }

      // One EOS for the whole sequence, after every clip has been drawn.
      encoder.signalEndOfInputStream()
      drainEncoder(true)

      if (muxerAudioTrack >= 0 && audioFormatForMuxer != null) {
        if (preRendered != null) {
          // Retimed/re-encoded path: the whole timeline was pre-rendered as
          // one continuous AAC stream — just hand its packets to the muxer.
          val info = MediaCodec.BufferInfo()
          for (p in preRendered.packets) {
            info.set(0, p.data.size, p.ptsUs, p.flags)
            muxer.writeSampleData(muxerAudioTrack, ByteBuffer.wrap(p.data), info)
          }
        } else {
          // Lossless passthrough (every contributing clip is 1x, matching
          // formats): copy samples per clip, offset onto the timeline. A
          // muted clip leaves a silent gap.
          val audioBufferInfo = MediaCodec.BufferInfo()
          val audioBuf = ByteBuffer.allocate(1 shl 20)
          for ((clipIndex, clip) in clips.withIndex()) {
            if (clip.muted) continue
            val aEx = MediaExtractor().apply { setDataSource(clip.uri) }
            val aTrack = findTrack(aEx, "audio/")
            if (aTrack < 0) {
              aEx.release()
              continue
            }
            aEx.selectTrack(aTrack)
            val trimInUs = (clip.trimIn * 1_000_000.0).toLong().coerceAtLeast(0L)
            val trimOutUs = if (clip.trimOut > clip.trimIn) (clip.trimOut * 1_000_000.0).toLong() else Long.MAX_VALUE
            aEx.seekTo(trimInUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            while (true) {
              audioBuf.clear()
              val size = aEx.readSampleData(audioBuf, 0)
              if (size < 0) break
              val ptsUs = aEx.sampleTime
              if (ptsUs > trimOutUs) break
              if (ptsUs >= trimInUs) {
                audioBufferInfo.set(0, size, clipStartsUs[clipIndex] + (ptsUs - trimInUs), aEx.sampleFlags)
                muxer.writeSampleData(muxerAudioTrack, audioBuf, audioBufferInfo)
              }
              aEx.advance()
            }
            aEx.release()
          }
        }
      }
    } finally {
      for (vo in videoOverlays) {
        try { vo.decoder.release() } catch (e: Exception) { }
      }
      try { encoder.stop() } catch (e: Exception) { }
      encoder.release()
      windowSurface.release()
      eglCore.release()
      surfaceTexture.release()
      decoderSurface.release()
      glThread.quitSafely()
      if (muxerStarted) {
        try { muxer.stop() } catch (e: Exception) { }
      }
      muxer.release()
    }
  }

  /** Same mime/sample-rate/channel-count means samples can share one muxer track. */
  private fun audioFormatMatches(a: MediaFormat, b: MediaFormat): Boolean = try {
    a.getString(MediaFormat.KEY_MIME) == b.getString(MediaFormat.KEY_MIME) &&
      a.getInteger(MediaFormat.KEY_SAMPLE_RATE) == b.getInteger(MediaFormat.KEY_SAMPLE_RATE) &&
      a.getInteger(MediaFormat.KEY_CHANNEL_COUNT) == b.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
  } catch (e: Exception) {
    false
  }

  private fun findTrack(extractor: MediaExtractor, mimePrefix: String): Int {
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(mimePrefix)) return i
    }
    return -1
  }
}
