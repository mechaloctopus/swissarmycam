package expo.modules.screenrecorder

import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Owns the MediaProjection / MediaRecorder / VirtualDisplay lifecycle for a
 * single recording session. All native calls run on one dedicated background
 * thread — MediaProjection.Callback registration requires a Looper thread,
 * and keeping every call on the same thread avoids MediaRecorder state races.
 * The calling (module) thread waits synchronously via a CountDownLatch so JS
 * promises resolve only once the native call has actually completed.
 */
object RecorderState {
  private var handlerThread: HandlerThread? = null
  private var handler: Handler? = null

  private var mediaProjection: MediaProjection? = null
  private var mediaRecorder: MediaRecorder? = null
  private var virtualDisplay: VirtualDisplay? = null

  var isRecording: Boolean = false
    private set

  var pendingResultCode: Int = 0
  var pendingResultData: Intent? = null
  var pendingOutputPath: String? = null
  var pendingWithMic: Boolean = false

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      // The system revoked the projection (e.g. stopped via Android's own
      // recording indicator) — release everything so state stays consistent.
      handler?.post { teardownInternal() }
    }
  }

  private fun ensureHandler(): Handler {
    handler?.let { return it }
    val thread = HandlerThread("LensiiScreenRecorder").apply { start() }
    handlerThread = thread
    val h = Handler(thread.looper)
    handler = h
    return h
  }

  /** Called from the foreground service once it is in the foreground state. */
  fun begin(context: Context): Boolean {
    val h = ensureHandler()
    var ok = false
    val latch = CountDownLatch(1)
    h.post {
      try {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val data = pendingResultData ?: throw IllegalStateException("Missing screen-capture consent data")
        val projection = manager.getMediaProjection(pendingResultCode, data)
          ?: throw IllegalStateException("System denied the MediaProjection")
        projection.registerCallback(projectionCallback, h)

        val metrics = context.resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        @Suppress("DEPRECATION")
        val recorder = MediaRecorder()
        if (pendingWithMic) {
          recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        }
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        if (pendingWithMic) {
          recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        }
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        recorder.setVideoSize(width, height)
        recorder.setVideoFrameRate(30)
        recorder.setVideoEncodingBitRate(8_000_000)
        recorder.setOutputFile(pendingOutputPath)
        recorder.prepare()

        val surface: Surface = recorder.surface
        val display = projection.createVirtualDisplay(
          "LensiiScreenRecord",
          width, height, density,
          DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
          surface, null, h
        )

        recorder.start()

        mediaProjection = projection
        mediaRecorder = recorder
        virtualDisplay = display
        isRecording = true
        ok = true
      } catch (e: Exception) {
        teardownInternal()
        ok = false
      } finally {
        latch.countDown()
      }
    }
    latch.await(6, TimeUnit.SECONDS)
    return ok
  }

  fun stop(context: Context): String? {
    if (!isRecording) return null
    val h = handler ?: return null
    var path: String? = null
    val latch = CountDownLatch(1)
    h.post {
      path = teardownInternal()
      latch.countDown()
    }
    latch.await(6, TimeUnit.SECONDS)
    context.stopService(Intent(context, ScreenRecordService::class.java))
    return path
  }

  private fun teardownInternal(): String? {
    val outPath = pendingOutputPath
    try { mediaRecorder?.stop() } catch (e: Exception) { /* may throw if stopped too soon after start */ }
    try { mediaRecorder?.reset() } catch (e: Exception) { }
    try { mediaRecorder?.release() } catch (e: Exception) { }
    mediaRecorder = null

    try { virtualDisplay?.release() } catch (e: Exception) { }
    virtualDisplay = null

    try {
      mediaProjection?.unregisterCallback(projectionCallback)
      mediaProjection?.stop()
    } catch (e: Exception) { }
    mediaProjection = null

    isRecording = false
    return outPath
  }
}
