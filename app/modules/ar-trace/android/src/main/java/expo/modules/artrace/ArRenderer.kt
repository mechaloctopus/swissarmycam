package expo.modules.artrace

import android.graphics.Bitmap
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.opengl.Matrix
import android.view.Surface
import com.google.ar.core.Anchor
import com.google.ar.core.AugmentedImage
import com.google.ar.core.Camera
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Pose
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

private const val FLOAT_SIZE = 4

/**
 * Reference width the edge filter samples at. A one-texel Sobel measures the
 * gradient across a single pixel, which on a 4000px phone photo is almost flat
 * — line mode would come out blank. Sampling a fixed fraction of the image
 * instead (never finer than one real texel, for small images) makes the
 * threshold mean the same thing whatever resolution gets imported.
 */
private const val EDGE_REF = 900f

/** Lock quality, best-first. Reported to JS so the HUD can be honest about it. */
const val LOCK_NONE = "NONE"
const val LOCK_SURFACE = "SURFACE"
const val LOCK_MARKER_COASTING = "MARKER_COASTING"
const val LOCK_MARKER = "MARKER"

// Full-screen quad in NDC, triangle-strip order BL, BR, TL, TR — also the
// exact input format ARCore's Frame.transformCoordinates2d expects.
private val NDC_QUAD_COORDS = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
private val OVERLAY_TEX_COORDS = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

private const val BG_VERTEX_SHADER = """
  uniform float uZoom;
  attribute vec4 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;
  void main() {
    gl_Position = vec4(aPosition.x * uZoom, aPosition.y * uZoom, aPosition.z, aPosition.w);
    vTexCoord = aTexCoord;
  }
"""

private const val BG_FRAGMENT_SHADER = """
  #extension GL_OES_EGL_image_external : require
  precision mediump float;
  varying vec2 vTexCoord;
  uniform samplerExternalOES sTexture;
  void main() {
    gl_FragColor = texture2D(sTexture, vTexCoord);
  }
"""

private const val OV_VERTEX_SHADER = """
  uniform mat4 uMVPMatrix;
  attribute vec4 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;
  void main() {
    gl_Position = uMVPMatrix * aPosition;
    vTexCoord = aTexCoord;
  }
"""

/**
 * Photo mode passes the image through. Line mode runs a Sobel edge detect and
 * draws only the edges — which is what you actually want to trace, since a
 * full-tone photo hides your own pencil line under it. Doing it in the shader
 * means it's live and free: no pre-processing pass, no second bitmap, and the
 * sensitivity slider re-renders instantly.
 */
private const val OV_FRAGMENT_SHADER = """
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D sTexture;
  uniform float uAlpha;
  uniform float uEdges;
  uniform float uEdgeLow;
  uniform vec2 uTexel;

  float lum(vec2 uv) {
    vec3 c = texture2D(sTexture, uv).rgb;
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 c = texture2D(sTexture, vTexCoord);
    if (uEdges < 0.5) {
      gl_FragColor = vec4(c.rgb, c.a * uAlpha);
      return;
    }
    float tl = lum(vTexCoord + vec2(-uTexel.x, -uTexel.y));
    float tc = lum(vTexCoord + vec2(0.0, -uTexel.y));
    float tr = lum(vTexCoord + vec2(uTexel.x, -uTexel.y));
    float ml = lum(vTexCoord + vec2(-uTexel.x, 0.0));
    float mr = lum(vTexCoord + vec2(uTexel.x, 0.0));
    float bl = lum(vTexCoord + vec2(-uTexel.x, uTexel.y));
    float bc = lum(vTexCoord + vec2(0.0, uTexel.y));
    float br = lum(vTexCoord + vec2(uTexel.x, uTexel.y));
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    float g = sqrt(gx * gx + gy * gy);
    float e = smoothstep(uEdgeLow, uEdgeLow + 0.25, g);
    gl_FragColor = vec4(0.0, 0.0, 0.0, e * c.a * uAlpha);
  }
"""

private fun toFloatBuffer(arr: FloatArray): FloatBuffer =
  ByteBuffer.allocateDirect(arr.size * FLOAT_SIZE).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
    put(arr)
    position(0)
  }

private fun loadShader(type: Int, src: String): Int {
  val shader = GLES20.glCreateShader(type)
  GLES20.glShaderSource(shader, src)
  GLES20.glCompileShader(shader)
  val status = IntArray(1)
  GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
  if (status[0] == 0) {
    val log = GLES20.glGetShaderInfoLog(shader)
    GLES20.glDeleteShader(shader)
    throw RuntimeException("Shader compile failed: $log")
  }
  return shader
}

private fun createProgram(vertexSrc: String, fragmentSrc: String): Int {
  val vs = loadShader(GLES20.GL_VERTEX_SHADER, vertexSrc)
  val fs = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)
  val program = GLES20.glCreateProgram()
  GLES20.glAttachShader(program, vs)
  GLES20.glAttachShader(program, fs)
  GLES20.glLinkProgram(program)
  val status = IntArray(1)
  GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0)
  if (status[0] == 0) {
    val log = GLES20.glGetProgramInfoLog(program)
    GLES20.glDeleteProgram(program)
    throw RuntimeException("Program link failed: $log")
  }
  return program
}

class ArRenderer(
  private val onTrackingState: (String) -> Unit,
  private val onAnchorResult: (Boolean) -> Unit,
  private val onLockMode: (String) -> Unit,
  private val onError: (String) -> Unit,
) : GLSurfaceView.Renderer {

  lateinit var view: ArTraceView

  @Volatile private var currentSession: Session? = null
  private var anchor: Anchor? = null
  private var markerAnchor: Anchor? = null
  /** Stable reference — ARCore mutates the trackable in place each frame. */
  private var markerImage: AugmentedImage? = null
  private var lastReportedState: TrackingState? = null
  private var lastLockMode = LOCK_NONE
  private var geometrySet = false

  private var viewportWidth = 1
  private var viewportHeight = 1

  private var cameraTextureId = 0
  private var bgProgram = 0
  private var bgPositionAttrib = 0
  private var bgTexCoordAttrib = 0
  private var bgZoomUniform = 0
  private var bgTextureUniform = 0

  private var overlayProgram = 0
  private var ovPositionAttrib = 0
  private var ovTexCoordAttrib = 0
  private var ovMvpUniform = 0
  private var ovAlphaUniform = 0
  private var ovTextureUniform = 0
  private var ovEdgesUniform = 0
  private var ovEdgeLowUniform = 0
  private var ovTexelUniform = 0
  private var overlayTextureId = 0
  private var overlayTexW = 1
  private var overlayTexH = 1

  private val quadPositionBuffer = toFloatBuffer(NDC_QUAD_COORDS)
  private val cameraTexCoords = FloatArray(8).also { OVERLAY_TEX_COORDS.copyInto(it) }
  private val cameraTexCoordBuffer = toFloatBuffer(cameraTexCoords)
  private val overlayTexCoordBuffer = toFloatBuffer(OVERLAY_TEX_COORDS)
  private var overlayPositionBuffer: FloatBuffer = toFloatBuffer(FloatArray(12))
  /** Image aspect (w/h); the quad is sized in real metres from this + overlayWidthMeters. */
  private var overlayAspect = 1f
  private var builtForWidth = -1f

  private val pendingTap = AtomicReference<FloatArray?>(null)
  private val bitmapDirty = AtomicBoolean(false)
  @Volatile private var pendingBitmapValue: Bitmap? = null
  @Volatile private var lastBitmap: Bitmap? = null
  private val resetRequested = AtomicBoolean(false)

  fun attachSession(session: Session?) {
    currentSession = session
    anchor?.detach()
    anchor = null
    markerAnchor?.detach()
    markerAnchor = null
    markerImage = null
    lastReportedState = null
    lastLockMode = LOCK_NONE
    geometrySet = false
    if (session != null && viewportWidth > 1) {
      session.setDisplayGeometry(Surface.ROTATION_0, viewportWidth, viewportHeight)
    }
  }

  fun setOverlayBitmap(bmp: Bitmap?) {
    pendingBitmapValue = bmp
    bitmapDirty.set(true)
  }

  fun requestPlaceAnchor(nx: Float, ny: Float) {
    pendingTap.set(floatArrayOf(nx, ny))
  }

  fun clearAnchor() {
    resetRequested.set(true)
  }

  /**
   * Shaders compile on the GPU at runtime, so a driver that rejects one is
   * something no build can catch — and throwing here would take the whole GL
   * thread (and the app) down. Report it and leave the programs at 0 instead;
   * the draw calls skip themselves and the tab stays alive to say why.
   */
  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    try {
      initGl()
    } catch (e: Exception) {
      onError(e.message ?: "This device's GPU rejected the AR shaders")
    }
  }

  private fun initGl() {
    // Cleared up front rather than in the catch: on EGL context recreation
    // these still hold ids from the dead context, and whichever program does
    // compile should keep working even if the other one doesn't.
    bgProgram = 0
    overlayProgram = 0

    val textures = IntArray(1)
    GLES20.glGenTextures(1, textures, 0)
    cameraTextureId = textures[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTextureId)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

    bgProgram = createProgram(BG_VERTEX_SHADER, BG_FRAGMENT_SHADER)
    bgPositionAttrib = GLES20.glGetAttribLocation(bgProgram, "aPosition")
    bgTexCoordAttrib = GLES20.glGetAttribLocation(bgProgram, "aTexCoord")
    bgZoomUniform = GLES20.glGetUniformLocation(bgProgram, "uZoom")
    bgTextureUniform = GLES20.glGetUniformLocation(bgProgram, "sTexture")

    overlayProgram = createProgram(OV_VERTEX_SHADER, OV_FRAGMENT_SHADER)
    ovPositionAttrib = GLES20.glGetAttribLocation(overlayProgram, "aPosition")
    ovTexCoordAttrib = GLES20.glGetAttribLocation(overlayProgram, "aTexCoord")
    ovMvpUniform = GLES20.glGetUniformLocation(overlayProgram, "uMVPMatrix")
    ovAlphaUniform = GLES20.glGetUniformLocation(overlayProgram, "uAlpha")
    ovTextureUniform = GLES20.glGetUniformLocation(overlayProgram, "sTexture")
    ovEdgesUniform = GLES20.glGetUniformLocation(overlayProgram, "uEdges")
    ovEdgeLowUniform = GLES20.glGetUniformLocation(overlayProgram, "uEdgeLow")
    ovTexelUniform = GLES20.glGetUniformLocation(overlayProgram, "uTexel")
    overlayTextureId = 0

    // EGL context may have been recreated — re-upload the last-known overlay image if any.
    lastBitmap?.let { uploadOverlayTexture(it) }

    currentSession?.setCameraTextureName(cameraTextureId)
  }

  override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
    GLES20.glViewport(0, 0, width, height)
    viewportWidth = width
    viewportHeight = height
    currentSession?.setDisplayGeometry(Surface.ROTATION_0, width, height)
    geometrySet = false
  }

  override fun onDrawFrame(gl: GL10?) {
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

    val session = currentSession ?: return

    if (bitmapDirty.compareAndSet(true, false)) {
      uploadOverlayTexture(pendingBitmapValue)
    }

    session.setCameraTextureName(cameraTextureId)

    val frame = try {
      session.update()
    } catch (e: CameraNotAvailableException) {
      onError("Camera not available")
      return
    }

    val camera: Camera = frame.camera

    if (frame.hasDisplayGeometryChanged() || !geometrySet) {
      frame.transformCoordinates2d(
        Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, NDC_QUAD_COORDS,
        Coordinates2d.TEXTURE_NORMALIZED, cameraTexCoords
      )
      cameraTexCoordBuffer.clear()
      cameraTexCoordBuffer.put(cameraTexCoords)
      cameraTexCoordBuffer.position(0)
      geometrySet = true
    }

    drawCameraBackground()

    val trackingState = camera.trackingState
    if (trackingState != lastReportedState) {
      lastReportedState = trackingState
      onTrackingState(trackingState.name)
    }

    if (resetRequested.compareAndSet(true, false)) {
      anchor?.detach()
      anchor = null
      markerAnchor?.detach()
      markerAnchor = null
      markerImage = null
    }

    updateMarker(frame)

    pendingTap.getAndSet(null)?.let { tap ->
      if (trackingState == TrackingState.TRACKING) {
        val px = tap[0] * viewportWidth
        val py = tap[1] * viewportHeight
        val hits = frame.hitTest(px, py)
        val hit = hits.firstOrNull { r ->
          val trackable = r.trackable
          (trackable is Plane && trackable.trackingState == TrackingState.TRACKING && trackable.isPoseInPolygon(r.hitPose)) ||
            (trackable is Point && trackable.trackingState == TrackingState.TRACKING)
        }
        if (hit != null) {
          anchor?.detach()
          anchor = hit.createAnchor()
          onAnchorResult(true)
        } else {
          onAnchorResult(false)
        }
      } else {
        onAnchorResult(false)
      }
    }

    // The marker always wins when it's available: it re-localizes against a
    // physical object every frame, so it can't accumulate drift the way a
    // pure SLAM anchor can. The tap-placed anchor is the fallback.
    //
    // While the marker is actually in shot, its centerPose is the freshest
    // estimate there is — fresher than the anchor, which is ARCore's
    // world-registered smoothing of the same observation. Out of shot, the
    // anchor is all that's left, and it's exactly the right thing to fall
    // back to since ARCore keeps correcting it against the world map.
    val liveMarker = markerImage?.takeIf {
      it.trackingState == TrackingState.TRACKING && it.trackingMethod == AugmentedImage.TrackingMethod.FULL_TRACKING
    }
    val markerFallback = markerAnchor?.takeIf { it.trackingState == TrackingState.TRACKING }
    val surface = anchor?.takeIf { it.trackingState == TrackingState.TRACKING }

    val pose: Pose? = liveMarker?.centerPose ?: markerFallback?.pose ?: surface?.pose

    val lockMode = when {
      liveMarker != null -> LOCK_MARKER
      markerFallback != null -> LOCK_MARKER_COASTING
      surface != null -> LOCK_SURFACE
      else -> LOCK_NONE
    }
    if (lockMode != lastLockMode) {
      lastLockMode = lockMode
      onLockMode(lockMode)
    }

    if (trackingState != TrackingState.TRACKING) return
    if (pose == null) return
    if (overlayTextureId == 0) return

    drawOverlay(camera, pose)
  }

  /**
   * Picks up the printed Lensii marker. ARCore reports it as an AugmentedImage
   * trackable; anchoring to the trackable (rather than to a world pose) means
   * ARCore keeps correcting the anchor every time it sees the marker again.
   *
   * trackingMethod distinguishes "I can see it right now" (FULL_TRACKING) from
   * "it's out of frame, I'm going on my world map" (LAST_KNOWN_POSE) — the
   * HUD surfaces that difference rather than pretending both are equally good.
   */
  private fun updateMarker(frame: Frame) {
    for (img in frame.getUpdatedTrackables(AugmentedImage::class.java)) {
      if (img.name != LensiiMarker.NAME) continue
      when (img.trackingState) {
        TrackingState.TRACKING -> {
          if (markerAnchor == null) {
            markerAnchor = img.createAnchor(img.centerPose)
            onAnchorResult(true)
          }
          markerImage = img
        }
        TrackingState.STOPPED -> {
          markerAnchor?.detach()
          markerAnchor = null
          markerImage = null
        }
        else -> Unit
      }
    }
  }

  private fun uploadOverlayTexture(bmp: Bitmap?) {
    if (bmp == null) {
      overlayTextureId = 0
      lastBitmap = null
      return
    }
    if (overlayTextureId == 0) {
      val ids = IntArray(1)
      GLES20.glGenTextures(1, ids, 0)
      overlayTextureId = ids[0]
    }
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTextureId)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)

    overlayTexW = bmp.width.coerceAtLeast(1)
    overlayTexH = bmp.height.coerceAtLeast(1)
    overlayAspect = if (bmp.height > 0) bmp.width.toFloat() / bmp.height.toFloat() else 1f
    builtForWidth = -1f
    lastBitmap = bmp
  }

  /**
   * Sizes the quad in real metres. With a marker lock this is literally true —
   * a 0.21 m width prints across an A4 sheet — because the marker's known
   * physical size is what fixes ARCore's world scale.
   */
  private fun ensureQuad(widthMeters: Float) {
    if (widthMeters == builtForWidth) return
    val halfW = widthMeters / 2f
    val halfH = halfW / overlayAspect
    overlayPositionBuffer = toFloatBuffer(
      floatArrayOf(
        -halfW, 0f, -halfH,
        halfW, 0f, -halfH,
        -halfW, 0f, halfH,
        halfW, 0f, halfH
      )
    )
    builtForWidth = widthMeters
  }

  private fun drawCameraBackground() {
    if (bgProgram == 0) return
    GLES20.glDisable(GLES20.GL_DEPTH_TEST)
    GLES20.glDepthMask(false)
    GLES20.glDisable(GLES20.GL_BLEND)

    GLES20.glUseProgram(bgProgram)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTextureId)
    GLES20.glUniform1i(bgTextureUniform, 0)
    GLES20.glUniform1f(bgZoomUniform, view.cameraZoom)

    quadPositionBuffer.position(0)
    GLES20.glEnableVertexAttribArray(bgPositionAttrib)
    GLES20.glVertexAttribPointer(bgPositionAttrib, 2, GLES20.GL_FLOAT, false, 0, quadPositionBuffer)

    cameraTexCoordBuffer.position(0)
    GLES20.glEnableVertexAttribArray(bgTexCoordAttrib)
    GLES20.glVertexAttribPointer(bgTexCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, cameraTexCoordBuffer)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(bgPositionAttrib)
    GLES20.glDisableVertexAttribArray(bgTexCoordAttrib)
  }

  private fun drawOverlay(camera: Camera, pose: Pose) {
    if (overlayProgram == 0) return
    ensureQuad(view.overlayWidthMeters.coerceIn(0.01f, 20f))

    GLES20.glEnable(GLES20.GL_BLEND)
    GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
    GLES20.glDepthMask(false)

    val viewMatrix = FloatArray(16)
    val projMatrix = FloatArray(16)
    camera.getViewMatrix(viewMatrix, 0)
    camera.getProjectionMatrix(projMatrix, 0, 0.05f, 100f)

    val modelMatrix = FloatArray(16)
    pose.toMatrix(modelMatrix, 0)
    Matrix.translateM(modelMatrix, 0, view.overlayOffsetX, 0f, view.overlayOffsetY)
    Matrix.rotateM(modelMatrix, 0, view.overlayRotation, 0f, 1f, 0f)

    val vpMatrix = FloatArray(16)
    Matrix.multiplyMM(vpMatrix, 0, projMatrix, 0, viewMatrix, 0)
    val mvpMatrix = FloatArray(16)
    Matrix.multiplyMM(mvpMatrix, 0, vpMatrix, 0, modelMatrix, 0)

    // Apply the same digital zoom as the camera background as a clip-space
    // scale, so the traced overlay stays visually aligned with the magnified
    // camera feed instead of appearing to shrink relative to it.
    val zoom = view.cameraZoom
    if (zoom != 1f) {
      val zoomMatrix = FloatArray(16)
      Matrix.setIdentityM(zoomMatrix, 0)
      zoomMatrix[0] = zoom
      zoomMatrix[5] = zoom
      val zoomed = FloatArray(16)
      Matrix.multiplyMM(zoomed, 0, zoomMatrix, 0, mvpMatrix, 0)
      System.arraycopy(zoomed, 0, mvpMatrix, 0, 16)
    }

    GLES20.glUseProgram(overlayProgram)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTextureId)
    GLES20.glUniform1i(ovTextureUniform, 0)
    GLES20.glUniformMatrix4fv(ovMvpUniform, 1, false, mvpMatrix, 0)
    GLES20.glUniform1f(ovAlphaUniform, view.overlayOpacity.coerceIn(0f, 1f))
    GLES20.glUniform1f(ovEdgesUniform, if (view.lineMode) 1f else 0f)
    GLES20.glUniform1f(ovEdgeLowUniform, view.lineThreshold.coerceIn(0.02f, 1f))
    GLES20.glUniform2f(
      ovTexelUniform,
      (1f / overlayTexW).coerceAtLeast(1f / EDGE_REF),
      (1f / overlayTexH).coerceAtLeast(1f / EDGE_REF)
    )

    overlayPositionBuffer.position(0)
    GLES20.glEnableVertexAttribArray(ovPositionAttrib)
    GLES20.glVertexAttribPointer(ovPositionAttrib, 3, GLES20.GL_FLOAT, false, 0, overlayPositionBuffer)

    overlayTexCoordBuffer.position(0)
    GLES20.glEnableVertexAttribArray(ovTexCoordAttrib)
    GLES20.glVertexAttribPointer(ovTexCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, overlayTexCoordBuffer)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(ovPositionAttrib)
    GLES20.glDisableVertexAttribArray(ovTexCoordAttrib)
    GLES20.glDisable(GLES20.GL_BLEND)
    GLES20.glDepthMask(true)
  }
}
