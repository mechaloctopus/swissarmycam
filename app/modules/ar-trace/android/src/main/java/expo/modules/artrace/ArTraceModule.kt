package expo.modules.artrace

import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    View(ArTraceView::class) {
      Events("onTrackingStateChange", "onAnchorPlaced", "onArError")

      Prop("imageUri") { view: ArTraceView, uri: String? -> view.setOverlayImage(uri) }
      Prop("overlayOpacity") { view: ArTraceView, v: Float -> view.overlayOpacity = v }
      Prop("overlayScale") { view: ArTraceView, v: Float -> view.overlayScale = v }
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
