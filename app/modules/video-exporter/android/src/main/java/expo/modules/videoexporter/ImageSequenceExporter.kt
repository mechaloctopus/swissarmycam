package expo.modules.videoexporter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.opengl.GLES20
import android.opengl.GLUtils
import android.opengl.Matrix

/**
 * Bakes a sequence of still images (e.g. a claymation/stop-motion frame set)
 * into an MP4 at a fixed frame rate. No decoder is involved — each frame is
 * just a bitmap uploaded as a regular 2D texture and drawn straight to the
 * encoder's input surface — so this is simpler and lower-risk than the
 * video-in-video decode/composite/encode pipeline (VideoExportEngine), even
 * though it reuses the same proven EGL/encoder building blocks (EglCore,
 * WindowSurface, TextureProgram).
 */
class ImageSequenceExporter(private val context: Context) {

  fun export(uris: List<String>, fps: Int, outputPath: String) {
    require(uris.isNotEmpty()) { "No frames to export" }
    val safeFps = fps.coerceAtLeast(1)

    val firstBmp = decodeImage(uris[0]) ?: throw IllegalStateException("Could not decode first frame")
    val width = firstBmp.width
    val height = firstBmp.height
    firstBmp.recycle()

    val frameDurationUs = 1_000_000L / safeFps
    val bitRate = (width * height * 4).coerceAtLeast(4_000_000)
    val outputFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
      setInteger(MediaFormat.KEY_FRAME_RATE, safeFps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val encoderInputSurface = encoder.createInputSurface()
    encoder.start()

    val eglCore = EglCore()
    val windowSurface = WindowSurface(eglCore, encoderInputSurface)
    windowSurface.makeCurrent()

    val program = TextureProgram(isExternal = false)
    val texId = program.createTexture()
    val identity = FloatArray(16).also { Matrix.setIdentityM(it, 0) }

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var muxerTrack = -1
    var muxerStarted = false
    val bufferInfo = MediaCodec.BufferInfo()

    fun drainEncoder(flush: Boolean) {
      if (flush) encoder.signalEndOfInputStream()
      while (true) {
        val outIndex = encoder.dequeueOutputBuffer(bufferInfo, 10_000L)
        when {
          outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            muxerTrack = muxer.addTrack(encoder.outputFormat)
            muxer.start()
            muxerStarted = true
          }
          outIndex >= 0 -> {
            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) bufferInfo.size = 0
            if (bufferInfo.size > 0 && muxerStarted) {
              val data = encoder.getOutputBuffer(outIndex)!!
              data.position(bufferInfo.offset)
              data.limit(bufferInfo.offset + bufferInfo.size)
              muxer.writeSampleData(muxerTrack, data, bufferInfo)
            }
            encoder.releaseOutputBuffer(outIndex, false)
            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return
          }
          else -> if (!flush) return
        }
      }
    }

    try {
      for ((i, uri) in uris.withIndex()) {
        val bmp = decodeImage(uri) ?: continue
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
        bmp.recycle()

        windowSurface.makeCurrent()
        GLES20.glViewport(0, 0, width, height)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glDisable(GLES20.GL_BLEND)
        program.draw(identity, identity, texId, 1f)

        windowSurface.setPresentationTime(i.toLong() * frameDurationUs * 1000L)
        windowSurface.swapBuffers()

        drainEncoder(false)
      }
      drainEncoder(true)
    } finally {
      try { encoder.stop() } catch (e: Exception) { }
      encoder.release()
      windowSurface.release()
      eglCore.release()
      if (muxerStarted) {
        try { muxer.stop() } catch (e: Exception) { }
      }
      muxer.release()
    }
  }

  private fun decodeImage(uri: String): Bitmap? = try {
    if (uri.startsWith("file://") || uri.startsWith("/")) {
      BitmapFactory.decodeFile(uri.removePrefix("file://"))
    } else {
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
    }
  } catch (e: Exception) {
    null
  }
}
