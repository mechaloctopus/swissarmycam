package expo.modules.videoexporter

import android.content.Context
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
 * Frame-accurate keyframed-overlay video export: decode the source video with
 * MediaCodec into a SurfaceTexture (an external OES GL texture), composite it
 * plus every overlay layer's interpolated transform for that frame's exact
 * timestamp via GLES into a MediaCodec encoder's input surface, and mux the
 * result back to MP4 (copying the original audio track through unchanged).
 *
 * This is the standard MediaCodec decode -> GLES composite -> encode shape
 * (the same one Android's own CTS DecodeEditEncodeTest and the widely-used
 * "Grafika" reference samples use) — not a screen capture, and not a faked
 * export: every output frame is a real re-encode of the composited image.
 */
class VideoExportEngine(private val context: Context) {

  fun export(
    videoPath: String,
    outputPath: String,
    layersJson: String,
    canvasWidth: Int,
    canvasHeight: Int,
    clipJson: String
  ) {
    val layers = LayerParser.parse(layersJson)
    val clip = LayerParser.parseClipOptions(clipJson)
    val trimInUs = (clip.trimIn * 1_000_000L).toLong().coerceAtLeast(0L)
    val trimOutUs = if (clip.trimOut > clip.trimIn) (clip.trimOut * 1_000_000L).toLong() else Long.MAX_VALUE
    val speed = clip.speed.coerceAtLeast(0.01)

    val videoExtractor = MediaExtractor().apply { setDataSource(videoPath) }
    val videoTrackIndex = findTrack(videoExtractor, "video/")
    require(videoTrackIndex >= 0) { "No video track in source" }
    videoExtractor.selectTrack(videoTrackIndex)
    val inputFormat = videoExtractor.getTrackFormat(videoTrackIndex)
    val videoWidth = inputFormat.getInteger(MediaFormat.KEY_WIDTH)
    val videoHeight = inputFormat.getInteger(MediaFormat.KEY_HEIGHT)
    val videoMime = inputFormat.getString(MediaFormat.KEY_MIME)!!

    videoExtractor.seekTo(trimInUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val audioExtractor = MediaExtractor().apply { setDataSource(videoPath) }
    val audioTrackIndex = findTrack(audioExtractor, "audio/")
    // Audio is passed through untouched, which is only correct at 1x. A speed
    // change would need real resampling (pitch-shifted) or time-stretching
    // (pitch-preserved) — neither is built yet, so rather than emit audio that
    // drifts out of sync with the retimed video, a speed-changed export is
    // silent and the UI says so up front.
    val speedChangesAudio = speed != 1.0
    val hasAudio = audioTrackIndex >= 0 && !clip.muted && !speedChangesAudio
    if (hasAudio) {
      audioExtractor.selectTrack(audioTrackIndex)
      audioExtractor.seekTo(trimInUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    }
    val audioFormat = if (hasAudio) audioExtractor.getTrackFormat(audioTrackIndex) else null

    val bitRate = (videoWidth * videoHeight * 4).coerceAtLeast(4_000_000)
    val outputFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, videoWidth, videoHeight).apply {
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

    val glThread = HandlerThread("LensiiVideoExportGL").apply { start() }
    val glHandler = Handler(glThread.looper)
    val frameWaiter = FrameWaiter()
    val surfaceTexture = SurfaceTexture(oesTextureId)
    surfaceTexture.setDefaultBufferSize(videoWidth, videoHeight)
    surfaceTexture.setOnFrameAvailableListener(frameWaiter, glHandler)
    val decoderSurface = Surface(surfaceTexture)

    val decoder = MediaCodec.createDecoderByType(videoMime)
    decoder.configure(inputFormat, decoderSurface, null, 0)
    decoder.start()

    // Upload every image/text overlay layer's bitmap once, up front.
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

    // Each "video" layer (a green/blue-screen clip) gets its own independent
    // decode pipeline, driven forward per base-video frame — see
    // OverlayVideoDecoder for why this is kept as its own small unit.
    data class VideoOverlay(val layer: ExportLayer, val decoder: OverlayVideoDecoder, val naturalW: Float, val naturalH: Float)
    val videoOverlays = layers.filter { it.kind == "video" && it.uri != null }.mapNotNull { layer ->
      try {
        val texId = chromaProgram.createTexture()
        val dec = OverlayVideoDecoder(layer.uri!!.removePrefix("file://"), glHandler, texId)
        val (natW, natH) = videoLayerNaturalSize()
        VideoOverlay(layer, dec, natW, natH)
      } catch (e: Exception) {
        null // A broken green-screen clip shouldn't fail the whole export.
      }
    }

    // Maps the Editor's contentFit="contain" preview canvas onto the video's native pixels.
    val containScale = (minOf(canvasWidth.toFloat() / videoWidth, canvasHeight.toFloat() / videoHeight))
      .let { if (it.isNaN() || it <= 0f) 1f else it }
    val offsetX = (canvasWidth - videoWidth * containScale) / 2f
    val offsetY = (canvasHeight - videoHeight * containScale) / 2f

    // Shared by every overlay kind: maps a keyframe transform (in Editor preview
    // canvas-space) to the NDC model matrix for drawing into the video frame.
    fun modelMatrixFor(t: ExportKeyframe, layoutW: Float, layoutH: Float, naturalW: Float, naturalH: Float): FloatArray {
      val anchorCanvasX = t.x.toFloat() + layoutW / 2f
      val anchorCanvasY = t.y.toFloat() + layoutH / 2f
      val anchorVideoX = (anchorCanvasX - offsetX) / containScale
      val anchorVideoY = (anchorCanvasY - offsetY) / containScale
      val quadW = (naturalW / containScale) * t.scale.toFloat()
      val quadH = (naturalH / containScale) * t.scale.toFloat()

      val ndcX = (anchorVideoX / videoWidth) * 2f - 1f
      val ndcY = 1f - (anchorVideoY / videoHeight) * 2f
      val ndcW = (quadW / videoWidth) * 2f
      val ndcH = (quadH / videoHeight) * 2f

      val model = FloatArray(16)
      Matrix.setIdentityM(model, 0)
      Matrix.translateM(model, 0, ndcX, ndcY, 0f)
      // Preview rotation is defined in a y-down coordinate space; NDC is y-up, so negate to match.
      Matrix.rotateM(model, 0, -t.rotation.toFloat(), 0f, 0f, 1f)
      Matrix.scaleM(model, 0, ndcW / 2f, ndcH / 2f, 1f)
      return model
    }

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var muxerVideoTrack = -1
    var muxerAudioTrack = -1
    var muxerStarted = false

    val bufferInfo = MediaCodec.BufferInfo()
    var inputDone = false
    var decoderDone = false
    var encoderDone = false
    val texMatrix = FloatArray(16)
    val identity = FloatArray(16).also { Matrix.setIdentityM(it, 0) }

    try {
      while (!encoderDone) {
        if (!inputDone) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val buf = decoder.getInputBuffer(inIndex)!!
            val sampleSize = videoExtractor.readSampleData(buf, 0)
            // Stop feeding once past the trim range — the decoder still needs
            // to drain what's already queued, so EOS is signalled here rather
            // than breaking out of the loop.
            if (sampleSize < 0 || videoExtractor.sampleTime > trimOutUs) {
              decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(inIndex, 0, sampleSize, videoExtractor.sampleTime, 0)
              videoExtractor.advance()
            }
          }
        }

        if (!decoderDone) {
          val outIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
          if (outIndex >= 0) {
            val isEos = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            val framePtsUs = bufferInfo.presentationTimeUs
            // Seeking to trimIn lands on the preceding sync frame, so frames
            // before the trim point still decode — they just must not be drawn.
            val inTrimRange = framePtsUs >= trimInUs && framePtsUs <= trimOutUs
            val doRender = bufferInfo.size > 0 && inTrimRange
            decoder.releaseOutputBuffer(outIndex, doRender)

            if (doRender) {
              frameWaiter.await(FRAME_WAIT_TIMEOUT_MS)
              surfaceTexture.updateTexImage()
              surfaceTexture.getTransformMatrix(texMatrix)

              windowSurface.makeCurrent()
              GLES20.glViewport(0, 0, videoWidth, videoHeight)
              GLES20.glClearColor(0f, 0f, 0f, 1f)
              GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

              GLES20.glDisable(GLES20.GL_BLEND)
              videoProgram.draw(identity, texMatrix, oesTextureId, 1f)

              GLES20.glEnable(GLES20.GL_BLEND)
              GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
              // Layers are keyed against timeline (output) time, so trim and
              // speed have to be undone here — the same conversion the preview
              // does in StudioScreen.
              val timelineSec = (framePtsUs - trimInUs) / 1_000_000.0 / speed

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
                // Overlay clips play from their own start when the layer comes
                // in, so they're driven by time-since-tIn rather than the base
                // video's timestamp.
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

              // Speed is applied by restamping output frames; the encoder is
              // otherwise unaware the timeline was retimed.
              val outPtsUs = ((framePtsUs - trimInUs) / speed).toLong().coerceAtLeast(0L)
              windowSurface.setPresentationTime(outPtsUs * 1000)
              windowSurface.swapBuffers()
            }

            if (isEos) {
              decoderDone = true
              encoder.signalEndOfInputStream()
            }
          }
        }

        val encOutIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        when {
          encOutIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            muxerVideoTrack = muxer.addTrack(encoder.outputFormat)
            if (hasAudio && audioFormat != null) muxerAudioTrack = muxer.addTrack(audioFormat)
            muxer.start()
            muxerStarted = true
          }
          encOutIndex >= 0 -> {
            val encodedData = encoder.getOutputBuffer(encOutIndex)!!
            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
              bufferInfo.size = 0
            }
            if (bufferInfo.size > 0 && muxerStarted) {
              encodedData.position(bufferInfo.offset)
              encodedData.limit(bufferInfo.offset + bufferInfo.size)
              muxer.writeSampleData(muxerVideoTrack, encodedData, bufferInfo)
            }
            encoder.releaseOutputBuffer(encOutIndex, false)
            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
              encoderDone = true
            }
          }
        }
      }

      // Audio is copied through untouched (1x only — see hasAudio above),
      // shifted so the trim point becomes t=0. Written after video because
      // MediaMuxer does not require cross-track samples to be interleaved.
      if (hasAudio && muxerAudioTrack >= 0) {
        val audioBufferInfo = MediaCodec.BufferInfo()
        val audioBuf = ByteBuffer.allocate(1 shl 20)
        while (true) {
          audioBuf.clear()
          val size = audioExtractor.readSampleData(audioBuf, 0)
          if (size < 0) break
          val ptsUs = audioExtractor.sampleTime
          if (ptsUs > trimOutUs) break
          if (ptsUs >= trimInUs) {
            audioBufferInfo.set(0, size, ptsUs - trimInUs, audioExtractor.sampleFlags)
            muxer.writeSampleData(muxerAudioTrack, audioBuf, audioBufferInfo)
          }
          audioExtractor.advance()
        }
      }
    } finally {
      for (vo in videoOverlays) {
        try { vo.decoder.release() } catch (e: Exception) { }
      }
      try { decoder.stop() } catch (e: Exception) { }
      decoder.release()
      try { encoder.stop() } catch (e: Exception) { }
      encoder.release()
      windowSurface.release()
      eglCore.release()
      surfaceTexture.release()
      decoderSurface.release()
      glThread.quitSafely()
      videoExtractor.release()
      audioExtractor.release()
      if (muxerStarted) {
        try { muxer.stop() } catch (e: Exception) { }
      }
      muxer.release()
    }
  }

  private fun findTrack(extractor: MediaExtractor, mimePrefix: String): Int {
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(mimePrefix)) return i
    }
    return -1
  }
}

