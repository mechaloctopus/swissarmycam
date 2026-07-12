package expo.modules.screenrecorder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CAPTURE_REQUEST_CODE = 55231

class ScreenRecorderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingPromise: Promise? = null
  private var pendingOutputPath: String? = null
  private var pendingWithMic: Boolean = false

  private val projectionManager: MediaProjectionManager
    get() = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

  override fun definition() = ModuleDefinition {
    Name("ScreenRecorder")

    Function("isRecording") {
      RecorderState.isRecording
    }

    // Shows the system's screen-share consent dialog, then — once the user
    // approves — starts the foreground service that owns the actual capture.
    AsyncFunction("startRecording") { outputPath: String, withMic: Boolean, promise: Promise ->
      if (RecorderState.isRecording) {
        promise.resolve(false)
        return@AsyncFunction
      }
      pendingPromise = promise
      pendingOutputPath = outputPath
      pendingWithMic = withMic
      val intent = projectionManager.createScreenCaptureIntent()
      appContext.throwingActivity.startActivityForResult(intent, CAPTURE_REQUEST_CODE)
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      val path = RecorderState.stop(context)
      promise.resolve(path)
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode != CAPTURE_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPromise
      pendingPromise = null

      if (resultCode != Activity.RESULT_OK || data == null) {
        promise?.resolve(false)
        return@OnActivityResult
      }

      RecorderState.pendingResultCode = resultCode
      RecorderState.pendingResultData = data
      RecorderState.pendingOutputPath = pendingOutputPath
      RecorderState.pendingWithMic = pendingWithMic

      val serviceIntent = Intent(context, ScreenRecordService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(serviceIntent)
      } else {
        context.startService(serviceIntent)
      }
      promise?.resolve(true)
    }
  }
}
