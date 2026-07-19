package expo.modules.artrace

import android.graphics.Bitmap
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.opengl.Matrix
import android.view.Surface
import com.google.ar.core.Anchor
import com.google.ar.core.Camera
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Plane
import com.google.ar.core.Point
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
private const val BASE_HALF_EXTENT = 0.2f // metres — traced quad half-size at overlayScale = 1

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

private const val OV_FRAGMENT_SHADER = """
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D sTexture;
  uniform float uAlpha;
  void main() {
    vec4 c = texture2D(sTexture, vTexCoord);
    gl_FragColor = vec4(c.rgb, c.a * uAlpha);
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
  private val onError: (String) -> Unit,
) : GLSurfaceView.Renderer {

  lateinit var view: ArTraceView

  @Volatile private var currentSession: Session? = null
  private var anchor: Anchor? = null
  private var lastReportedState: TrackingState? = null
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
  private var overlayTextureId = 0

  private val quadPositionBuffer = toFloatBuffer(NDC_QUAD_COORDS)
  private val cameraTexCoords = FloatArray(8).also { OVERLAY_TEX_COORDS.copyInto(it) }
  private val cameraTexCoordBuffer = toFloatBuffer(cameraTexCoords)
  private val overlayTexCoordBuffer = toFloatBuffer(OVERLAY_TEX_COORDS)
  private var overlayPositionBuffer: FloatBuffer = toFloatBuffer(
    floatArrayOf(
      -BASE_HALF_EXTENT, 0f, -BASE_HALF_EXTENT,
      BASE_HALF_EXTENT, 0f, -BASE_HALF_EXTENT,
      -BASE_HALF_EXTENT, 0f, BASE_HALF_EXTENT,
      BASE_HALF_EXTENT, 0f, BASE_HALF_EXTENT
    )
  )

  private val pendingTap = AtomicReference<FloatArray?>(null)
  private val bitmapDirty = AtomicBoolean(false)
  @Volatile private var pendingBitmapValue: Bitmap? = null
  @Volatile private var lastBitmap: Bitmap? = null
  private val resetRequested = AtomicBoolean(false)

  fun attachSession(session: Session?) {
    currentSession = session
    anchor?.detach()
    anchor = null
    lastReportedState = null
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

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
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
    }

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

    if (trackingState != TrackingState.TRACKING) return
    val currentAnchor = anchor ?: return
    if (currentAnchor.trackingState != TrackingState.TRACKING) return
    if (overlayTextureId == 0) return

    drawOverlay(camera, currentAnchor)
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

    val aspect = bmp.width.toFloat() / bmp.height.toFloat()
    val halfW = if (aspect >= 1f) BASE_HALF_EXTENT * aspect else BASE_HALF_EXTENT
    val halfH = if (aspect >= 1f) BASE_HALF_EXTENT else BASE_HALF_EXTENT / aspect
    overlayPositionBuffer = toFloatBuffer(
      floatArrayOf(
        -halfW, 0f, -halfH,
        halfW, 0f, -halfH,
        -halfW, 0f, halfH,
        halfW, 0f, halfH
      )
    )
    lastBitmap = bmp
  }

  private fun drawCameraBackground() {
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

  private fun drawOverlay(camera: Camera, anchor: Anchor) {
    GLES20.glEnable(GLES20.GL_BLEND)
    GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
    GLES20.glDepthMask(false)

    val viewMatrix = FloatArray(16)
    val projMatrix = FloatArray(16)
    camera.getViewMatrix(viewMatrix, 0)
    camera.getProjectionMatrix(projMatrix, 0, 0.05f, 100f)

    val modelMatrix = FloatArray(16)
    anchor.pose.toMatrix(modelMatrix, 0)
    Matrix.translateM(modelMatrix, 0, view.overlayOffsetX, 0f, view.overlayOffsetY)
    Matrix.rotateM(modelMatrix, 0, view.overlayRotation, 0f, 1f, 0f)
    Matrix.scaleM(modelMatrix, 0, view.overlayScale, 1f, view.overlayScale)

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
