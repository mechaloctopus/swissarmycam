package expo.modules.artrace

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.opengl.GLSurfaceView
import android.view.ViewGroup
import com.google.ar.core.ArCoreApk
import com.google.ar.core.AugmentedImageDatabase
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Hosts a GLSurfaceView that renders the ARCore camera feed plus a
 * surface-anchored overlay image.
 *
 * Two lock sources, best-available wins:
 *  - **Marker** — a printed Lensii marker registered as an ARCore
 *    AugmentedImage. Because it re-detects a physical object, it re-localizes
 *    every frame it's in view instead of dead-reckoning, and its known printed
 *    width is what pins world scale to real millimetres.
 *  - **Surface** — the original tap-to-place SLAM anchor, for when there's
 *    nothing to tape a marker to.
 *
 * Either way the pose comes from ARCore, not from app-side math; this view
 * just draws relative to whatever it reports. `cameraZoom` only crops the
 * rendered pixels — it never touches the anchor.
 */
class ArTraceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onTrackingStateChange by EventDispatcher()
  val onAnchorPlaced by EventDispatcher()
  val onLockModeChange by EventDispatcher()
  val onAutoLock by EventDispatcher()
  val onArError by EventDispatcher()

  private val glSurfaceView: GLSurfaceView = GLSurfaceView(context)
  private val renderer: ArRenderer = ArRenderer(
    onTrackingState = { state -> post { onTrackingStateChange(mapOf("state" to state)) } },
    onAnchorResult = { success -> post { onAnchorPlaced(mapOf("success" to success)) } },
    onLockMode = { mode -> post { onLockModeChange(mapOf("mode" to mode)) } },
    onError = { msg -> post { onArError(mapOf("message" to msg)) } },
  )

  private var session: Session? = null
  private var paused = false

  @Volatile var overlayOpacity: Float = 0.85f
  /** Draw extracted edges instead of the photo — what you actually trace. */
  @Volatile var lineMode: Boolean = false
  @Volatile var lineThreshold: Float = 0.18f
  @Volatile var overlayWidthMeters: Float = 0.21f
  @Volatile var overlayRotation: Float = 0f
  @Volatile var overlayOffsetX: Float = 0f
  @Volatile var overlayOffsetY: Float = 0f
  @Volatile var cameraZoom: Float = 1f
    set(v) { field = v.coerceIn(1f, 5f) }
  @Volatile var pendingTapX: Float = 0.5f
  @Volatile var pendingTapY: Float = 0.5f

  /** Printed width of the physical marker, in metres. Wrong value = wrong scale. */
  private var markerWidthMeters: Float = 0.1f

  /** Runtime surface snapshot used as a marker when nothing is printed. */
  @Volatile private var autoImage: Bitmap? = null
  @Volatile private var autoImageWidth: Float = 0f

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
      newSession.configure(buildConfig(newSession))
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

  /**
   * Registering the marker with its true printed width is what gives the
   * session real metric scale — it's also why changing that width has to
   * reconfigure the session rather than just scaling a matrix.
   */
  private fun buildConfig(target: Session): Config {
    val config = Config(target)
    config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
    config.updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
    config.focusMode = Config.FocusMode.AUTO
    try {
      val db = AugmentedImageDatabase(target)
      db.addImage(LensiiMarker.NAME, LensiiMarker.bitmap(), markerWidthMeters)
      addAutoImage(db)
      config.augmentedImageDatabase = db
    } catch (e: Exception) {
      // Tracing still works off the tap-placed surface anchor without it.
      // Posted, not called inline: buildConfig also runs on the GL thread when
      // an auto lock is applied.
      val msg = e.message ?: "database error"
      post { onArError(mapOf("message" to "Marker tracking unavailable: $msg")) }
    }
    return config
  }

  /**
   * Adds the runtime surface snapshot, if there is one. Kept in its own try so
   * a snapshot ARCore judges untrackable — a blank sheet, a wall in flat light
   * — is dropped without taking the printed marker down with it.
   */
  private fun addAutoImage(db: AugmentedImageDatabase) {
    val img = autoImage ?: return
    try {
      if (autoImageWidth > 0f) db.addImage(AUTO_IMAGE_NAME, img, autoImageWidth)
      else db.addImage(AUTO_IMAGE_NAME, img)
    } catch (e: Exception) {
      // Reported by the caller, which knows whether this survived.
      autoImage = null
      autoImageWidth = 0f
    }
  }

  /**
   * Registers a freshly grabbed surface snapshot and restarts the session on it.
   * Called from the GL thread right after the frame it captured, which is a
   * safe point to reconfigure — session.update() has already returned.
   */
  fun applyAutoLockImage(bmp: Bitmap, widthMeters: Float) {
    autoImage = bmp
    autoImageWidth = widthMeters
    val s = session ?: return
    try {
      s.configure(buildConfig(s))
      // addAutoImage clears the snapshot if ARCore judged it untrackable.
      val ok = autoImage != null
      val mm = (widthMeters * 1000f).toInt()
      post {
        onAutoLock(mapOf(
          "ok" to ok,
          "widthMm" to mm,
          "reason" to if (ok) "" else "not enough texture on that surface",
        ))
      }
    } catch (e: Exception) {
      autoImage = null
      autoImageWidth = 0f
      post { onArError(mapOf("message" to (e.message ?: "Could not apply the auto lock"))) }
    }
  }

  fun requestAutoLock() {
    renderer.requestAutoLock()
  }

  fun setMarkerWidthMeters(v: Float) {
    val next = v.coerceIn(0.02f, 2f)
    if (next == markerWidthMeters) return
    markerWidthMeters = next
    val s = session ?: return
    try {
      s.configure(buildConfig(s))
    } catch (e: Exception) {
      onArError(mapOf("message" to (e.message ?: "Could not update marker size")))
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
