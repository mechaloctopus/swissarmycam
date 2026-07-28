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
  /** "standard" | "camcorder" | "raw" — see mapAudioSources() below. */
  var pendingAudioSource: String = "standard"

  /**
   * "raw" asks the audio HAL itself to skip its noise-suppression/AGC chain
   * (Android's own documented way to get unprocessed audio — a source-level
   * request, not an app-side effect toggle bolted on afterwards) via
   * UNPROCESSED, falling back to VOICE_RECOGNITION (also AGC/NS-free) if a
   * device doesn't support UNPROCESSED, and finally to MIC if neither
   * source is accepted. "camcorder" prefers the camera-tuned mic input.
   * Every fallback is attempted for real at prepare() time, not assumed.
   */
  private fun mapAudioSources(pref: String): List<Int> = when (pref) {
    "raw" -> listOf(MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)
    "camcorder" -> listOf(MediaRecorder.AudioSource.CAMCORDER, MediaRecorder.AudioSource.MIC)
    else -> listOf(MediaRecorder.AudioSource.MIC)
  }

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

        // -1 = no audio source to try at all (mic disabled entirely).
        val audioSourcesToTry = if (pendingWithMic) mapAudioSources(pendingAudioSource) else listOf(-1)
        var recorder: MediaRecorder? = null
        var lastError: Exception? = null
        for (audioSource in audioSourcesToTry) {
          @Suppress("DEPRECATION")
          val r = MediaRecorder()
          try {
            if (pendingWithMic && audioSource >= 0) {
              r.setAudioSource(audioSource)
            }
            r.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            if (pendingWithMic) {
              r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            }
            r.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            r.setVideoSize(width, height)
            r.setVideoFrameRate(30)
            r.setVideoEncodingBitRate(8_000_000)
            r.setOutputFile(pendingOutputPath)
            r.prepare()
            recorder = r
            break
          } catch (e: Exception) {
            lastError = e
            try { r.release() } catch (e2: Exception) { }
          }
        }
        if (recorder == null) throw lastError ?: IllegalStateException("Could not prepare MediaRecorder")

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
