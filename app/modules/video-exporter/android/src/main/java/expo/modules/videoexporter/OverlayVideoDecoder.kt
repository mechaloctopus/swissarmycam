package expo.modules.videoexporter

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Handler
import android.view.Surface

private const val TIMEOUT_US = 10_000L
private const val FRAME_WAIT_TIMEOUT_MS = 1_500L

/**
 * Owns one overlay (green-screen) video's decode pipeline — its own
 * MediaExtractor, MediaCodec decoder, and SurfaceTexture bound to a
 * caller-provided external OES texture — so the base video's render loop can
 * pull "the frame at or after time T" from it independently of the base
 * video's own decoder. Kept as its own small, additive unit: a bug here
 * can't affect the base-video-only export path that already shipped.
 *
 * Sync strategy is nearest-forward: for each base-video frame's timestamp,
 * decode the overlay clip forward until its next frame's pts is at or past
 * that time. Once the overlay clip runs out, it simply stops contributing —
 * it is not looped.
 */
class OverlayVideoDecoder(path: String, glHandler: Handler, val texId: Int) {
  private val extractor = MediaExtractor().apply { setDataSource(path) }
  private val decoder: MediaCodec
  private val surfaceTexture: SurfaceTexture
  private val surface: Surface
  private val frameWaiter = FrameWaiter()
  private val bufferInfo = MediaCodec.BufferInfo()
  val texMatrix = FloatArray(16)

  var currentPtsUs: Long = -1L
    private set
  var finished = false
    private set

  private var inputDone = false

  init {
    var trackIndex = -1
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("video/")) {
        trackIndex = i
        break
      }
    }
    require(trackIndex >= 0) { "Overlay clip has no video track" }
    extractor.selectTrack(trackIndex)
    val format = extractor.getTrackFormat(trackIndex)
    val mime = format.getString(MediaFormat.KEY_MIME)!!

    surfaceTexture = SurfaceTexture(texId)
    val w = if (format.containsKey(MediaFormat.KEY_WIDTH)) format.getInteger(MediaFormat.KEY_WIDTH) else 1280
    val h = if (format.containsKey(MediaFormat.KEY_HEIGHT)) format.getInteger(MediaFormat.KEY_HEIGHT) else 720
    surfaceTexture.setDefaultBufferSize(w, h)
    surfaceTexture.setOnFrameAvailableListener(frameWaiter, glHandler)
    surface = Surface(surfaceTexture)

    decoder = MediaCodec.createDecoderByType(mime)
    decoder.configure(format, surface, null, 0)
    decoder.start()
  }

  /** Returns true if a frame at/after [targetPtsUs] is now current and ready to draw. */
  fun advanceTo(targetPtsUs: Long): Boolean {
    if (finished) return false
    while (currentPtsUs < targetPtsUs) {
      if (!inputDone) {
        val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
        if (inIndex >= 0) {
          val buf = decoder.getInputBuffer(inIndex)!!
          val sampleSize = extractor.readSampleData(buf, 0)
          if (sampleSize < 0) {
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
        val doRender = bufferInfo.size > 0
        val isEos = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
        val pts = bufferInfo.presentationTimeUs
        decoder.releaseOutputBuffer(outIndex, doRender)
        if (doRender) {
          frameWaiter.await(FRAME_WAIT_TIMEOUT_MS)
          surfaceTexture.updateTexImage()
          surfaceTexture.getTransformMatrix(texMatrix)
          currentPtsUs = pts
        }
        if (isEos) {
          finished = true
          break
        }
      }
    }
    return !finished && currentPtsUs >= 0
  }

  fun release() {
    try {
      decoder.stop()
    } catch (e: Exception) {
    }
    decoder.release()
    surface.release()
    surfaceTexture.release()
    extractor.release()
  }
}
