package expo.modules.artrace

import android.graphics.Bitmap
import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class ArTraceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArTrace")

    Function("isAvailable") { true }

    AsyncFunction("checkAvailability") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        val availability = ArCoreApk.getInstance().checkAvailability(context)
        promise.resolve(availability.name)
      } catch (e: Exception) {
        promise.reject("AR_CHECK_FAILED", e.message ?: "Could not check AR availability", e)
      }
    }

    AsyncFunction("requestInstall") { promise: Promise ->
      try {
        val activity = appContext.currentActivity ?: throw IllegalStateException("No current activity")
        val status = ArCoreApk.getInstance().requestInstall(activity, true)
        promise.resolve(status.name)
      } catch (e: Exception) {
        promise.reject("AR_INSTALL_FAILED", e.message ?: "Could not request ARCore install", e)
      }
    }

    /**
     * Writes the printable tracking marker to a PNG the user can share/print.
     * Same bitmap the AugmentedImageDatabase is built from, so what gets
     * printed is exactly what the tracker is looking for.
     */
    AsyncFunction("exportMarker") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        val file = File(context.cacheDir, "lensii-trace-marker.png")
        FileOutputStream(file).use { out ->
          LensiiMarker.bitmap(1600).compress(Bitmap.CompressFormat.PNG, 100, out)
        }
        promise.resolve("file://${file.absolutePath}")
      } catch (e: Exception) {
        promise.reject("AR_MARKER_EXPORT_FAILED", e.message ?: "Could not write the marker", e)
      }
    }

    View(ArTraceView::class) {
      Events("onTrackingStateChange", "onAnchorPlaced", "onLockModeChange", "onArError")

      Prop("imageUri") { view: ArTraceView, uri: String? -> view.setOverlayImage(uri) }
      Prop("overlayOpacity") { view: ArTraceView, v: Float -> view.overlayOpacity = v }
      Prop("overlayWidthMeters") { view: ArTraceView, v: Float -> view.overlayWidthMeters = v }
      Prop("markerWidthMeters") { view: ArTraceView, v: Float -> view.setMarkerWidthMeters(v) }
      Prop("overlayRotation") { view: ArTraceView, v: Float -> view.overlayRotation = v }
      Prop("overlayOffsetX") { view: ArTraceView, v: Float -> view.overlayOffsetX = v }
      Prop("overlayOffsetY") { view: ArTraceView, v: Float -> view.overlayOffsetY = v }
      Prop("cameraZoom") { view: ArTraceView, v: Float -> view.cameraZoom = v }
      Prop("placeAnchorX") { view: ArTraceView, v: Float -> view.pendingTapX = v }
      Prop("placeAnchorY") { view: ArTraceView, v: Float -> view.pendingTapY = v }
      Prop("placeAnchorTrigger") { view: ArTraceView, _: Int -> view.requestPlaceAnchor() }
      Prop("resetTrigger") { view: ArTraceView, _: Int -> view.resetAnchor() }
      Prop("paused") { view: ArTraceView, v: Boolean -> view.setPaused(v) }
    }
  }
}
