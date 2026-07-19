package expo.modules.artrace

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.opengl.GLSurfaceView
import android.view.ViewGroup
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Hosts a GLSurfaceView that renders the ARCore camera feed plus a
 * surface-anchored overlay image. The anchor is world-tracked by ARCore's
 * SLAM pipeline, not by app code — "locked, not drifting" is ARCore doing
 * its job, this view just draws relative to whatever pose it reports each
 * frame. `cameraZoom` only crops/magnifies the rendered pixels; it never
 * touches the anchor or the tracked pose.
 */
class ArTraceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onTrackingStateChange by EventDispatcher()
  val onAnchorPlaced by EventDispatcher()
  val onArError by EventDispatcher()

  private val glSurfaceView: GLSurfaceView = GLSurfaceView(context)
  private val renderer: ArRenderer = ArRenderer(
    onTrackingState = { state -> post { onTrackingStateChange(mapOf("state" to state)) } },
    onAnchorResult = { success -> post { onAnchorPlaced(mapOf("success" to success)) } },
    onError = { msg -> post { onArError(mapOf("message" to msg)) } },
  )

  private var session: Session? = null
  private var paused = false

  @Volatile var overlayOpacity: Float = 0.85f
  @Volatile var overlayScale: Float = 1f
  @Volatile var overlayRotation: Float = 0f
  @Volatile var overlayOffsetX: Float = 0f
  @Volatile var overlayOffsetY: Float = 0f
  @Volatile var cameraZoom: Float = 1f
    set(v) { field = v.coerceIn(1f, 5f) }
  @Volatile var pendingTapX: Float = 0.5f
  @Volatile var pendingTapY: Float = 0.5f

  init {
    renderer.view = this
    glSurfaceView.setEGLContextClientVersion(2)
    glSurfaceView.preserveEGLContextOnPause = true
    glSurfaceView.setRenderer(renderer)
    glSurfaceView.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
    addView(glSurfaceView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    startSession()
  }

  override fun onDetachedFromWindow() {
    stopSession()
    super.onDetachedFromWindow()
  }

  private fun startSession() {
    if (session != null) return
    try {
      val availability = ArCoreApk.getInstance().checkAvailability(context)
      if (!availability.isSupported) {
        onArError(mapOf("message" to "AR is not supported on this device (${availability.name})"))
        return
      }
      val newSession = Session(context)
      val config = Config(newSession)
      config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
      config.updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
      config.focusMode = Config.FocusMode.AUTO
      newSession.configure(config)
      session = newSession
      renderer.attachSession(newSession)
      if (!paused) {
        newSession.resume()
        glSurfaceView.onResume()
      }
    } catch (e: UnavailableException) {
      onArError(mapOf("message" to (e.message ?: "ARCore is unavailable")))
    } catch (e: Exception) {
      onArError(mapOf("message" to (e.message ?: "Could not start the AR session")))
    }
  }

  private fun stopSession() {
    glSurfaceView.onPause()
    renderer.attachSession(null)
    try { session?.pause() } catch (e: Exception) { }
    session?.close()
    session = null
  }

  fun setPaused(v: Boolean) {
    if (paused == v) return
    paused = v
    val s = session ?: return
    try {
      if (paused) {
        s.pause()
        glSurfaceView.onPause()
      } else {
        glSurfaceView.onResume()
        s.resume()
      }
    } catch (e: CameraNotAvailableException) {
      onArError(mapOf("message" to "Camera not available"))
    }
  }

  fun setOverlayImage(uri: String?) {
    if (uri == null) {
      renderer.setOverlayBitmap(null)
      return
    }
    try {
      val bmp: Bitmap? = if (uri.startsWith("file://") || uri.startsWith("/")) {
        BitmapFactory.decodeFile(uri.removePrefix("file://"))
      } else {
        context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
      }
      if (bmp == null) {
        onArError(mapOf("message" to "Could not decode overlay image"))
        return
      }
      renderer.setOverlayBitmap(bmp)
    } catch (e: Exception) {
      onArError(mapOf("message" to (e.message ?: "Could not load overlay image")))
    }
  }

  fun requestPlaceAnchor() {
    renderer.requestPlaceAnchor(pendingTapX, pendingTapY)
  }

  fun resetAnchor() {
    renderer.clearAnchor()
  }
}
