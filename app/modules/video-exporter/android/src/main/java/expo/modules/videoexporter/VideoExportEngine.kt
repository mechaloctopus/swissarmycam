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

  fun export(videoPath: String, outputPath: String, layersJson: String, canvasWidth: Int, canvasHeight: Int) {
    val layers = LayerParser.parse(layersJson)

    val videoExtractor = MediaExtractor().apply { setDataSource(videoPath) }
    val videoTrackIndex = findTrack(videoExtractor, "video/")
    require(videoTrackIndex >= 0) { "No video track in source" }
    videoExtractor.selectTrack(videoTrackIndex)
    val inputFormat = videoExtractor.getTrackFormat(videoTrackIndex)
    val videoWidth = inputFormat.getInteger(MediaFormat.KEY_WIDTH)
    val videoHeight = inputFormat.getInteger(MediaFormat.KEY_HEIGHT)
    val videoMime = inputFormat.getString(MediaFormat.KEY_MIME)!!

    val audioExtractor = MediaExtractor().apply { setDataSource(videoPath) }
    val audioTrackIndex = findTrack(audioExtractor, "audio/")
    val hasAudio = audioTrackIndex >= 0
    if (hasAudio) audioExtractor.selectTrack(audioTrackIndex)
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
    val chromaProgram = ChromaKeyProgram()
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
            if (sampleSize < 0) {
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
            val doRender = bufferInfo.size > 0
            val isEos = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            val framePtsUs = bufferInfo.presentationTimeUs
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
              val frameTimeSec = framePtsUs / 1_000_000.0

              for (ov in overlays) {
                val t = LayerParser.transformAt(ov.layer, frameTimeSec)
                val model = modelMatrixFor(t, ov.layoutW, ov.layoutH, ov.naturalW, ov.naturalH)
                overlayProgram.draw(model, identity, ov.texId, (t.opacity / 100.0).toFloat())
              }

              for (vo in videoOverlays) {
                if (!vo.decoder.advanceTo(framePtsUs)) continue
                val t = LayerParser.transformAt(vo.layer, frameTimeSec)
                val model = modelMatrixFor(t, vo.naturalW, vo.naturalH, vo.naturalW, vo.naturalH)
                val keyColor = vo.layer.keyColor ?: listOf(0.06f, 0.72f, 0.2f)
                chromaProgram.draw(model, vo.decoder.texMatrix, vo.decoder.texId, keyColor, vo.layer.threshold, vo.layer.smoothing, (t.opacity / 100.0).toFloat())
              }

              windowSurface.setPresentationTime(framePtsUs * 1000)
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

      // Audio is copied through untouched — written after video since MediaMuxer
      // does not require samples from different tracks to be interleaved in order.
      if (hasAudio && muxerAudioTrack >= 0) {
        val audioBufferInfo = MediaCodec.BufferInfo()
        val audioBuf = ByteBuffer.allocate(1 shl 20)
        while (true) {
          audioBuf.clear()
          val size = audioExtractor.readSampleData(audioBuf, 0)
          if (size < 0) break
          audioBufferInfo.set(0, size, audioExtractor.sampleTime, audioExtractor.sampleFlags)
          muxer.writeSampleData(muxerAudioTrack, audioBuf, audioBufferInfo)
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

