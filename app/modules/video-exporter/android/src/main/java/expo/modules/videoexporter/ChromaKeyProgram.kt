package expo.modules.videoexporter

import android.opengl.GLES11Ext
import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

private const val FLOAT_SIZE = 4
private val QUAD_COORDS = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
private val QUAD_TEX_COORDS = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

private fun makeBuffer(coords: FloatArray): FloatBuffer =
  ByteBuffer.allocateDirect(coords.size * FLOAT_SIZE).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
    put(coords)
    position(0)
  }

private const val VERTEX_SHADER = """
  uniform mat4 uMVPMatrix;
  uniform mat4 uTexMatrix;
  attribute vec4 aPosition;
  attribute vec4 aTextureCoord;
  varying vec2 vTextureCoord;
  void main() {
    gl_Position = uMVPMatrix * aPosition;
    vTextureCoord = (uTexMatrix * aTextureCoord).xy;
  }
"""

// A distance + smoothstep key. Two variants because a decoded video frame is
// an external OES texture while an imported still is a regular 2D texture, and
// GLSL needs a different sampler type for each — same split TextureProgram
// already makes. The body is otherwise identical so both paths key alike.
private const val CHROMA_BODY = """
  varying vec2 vTextureCoord;
  uniform vec3 uKeyColor;
  uniform float uThreshold;
  uniform float uSmoothing;
  uniform float uAlpha;
  void main() {
    vec4 c = texture2D(sTexture, vTextureCoord);
    float dist = distance(c.rgb, uKeyColor);
    float keyAlpha = smoothstep(uThreshold, uThreshold + uSmoothing, dist);
    gl_FragColor = vec4(c.rgb, keyAlpha * uAlpha * c.a);
  }
"""

// Precision is declared before the sampler deliberately: samplerExternalOES
// has no default precision under GL_OES_EGL_image_external, and some drivers
// reject it if a float precision hasn't been established first. This is the
// ordering the previously-shipping shader used, so it's preserved verbatim.
private const val FRAGMENT_SHADER_CHROMA_EXT =
  "#extension GL_OES_EGL_image_external : require\n" +
    "precision mediump float;\n" +
    "uniform samplerExternalOES sTexture;\n" + CHROMA_BODY

private const val FRAGMENT_SHADER_CHROMA_2D =
  "precision mediump float;\n" +
    "uniform sampler2D sTexture;\n" + CHROMA_BODY

/**
 * Draws a chroma-keyed texture as a transparent-background quad. `isExternal`
 * picks the sampler type: true for a decoded video frame (external OES),
 * false for an imported still's 2D texture — so green-screen PNGs/JPEGs key
 * through exactly the same shader maths as green-screen clips.
 */
class ChromaKeyProgram(isExternal: Boolean = true) {
  val textureTarget: Int = if (isExternal) GLES11Ext.GL_TEXTURE_EXTERNAL_OES else GLES20.GL_TEXTURE_2D

  private val program = createProgram(VERTEX_SHADER, if (isExternal) FRAGMENT_SHADER_CHROMA_EXT else FRAGMENT_SHADER_CHROMA_2D)
  private val positionHandle = GLES20.glGetAttribLocation(program, "aPosition")
  private val texCoordHandle = GLES20.glGetAttribLocation(program, "aTextureCoord")
  private val mvpMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix")
  private val texMatrixHandle = GLES20.glGetUniformLocation(program, "uTexMatrix")
  private val keyColorHandle = GLES20.glGetUniformLocation(program, "uKeyColor")
  private val thresholdHandle = GLES20.glGetUniformLocation(program, "uThreshold")
  private val smoothingHandle = GLES20.glGetUniformLocation(program, "uSmoothing")
  private val alphaHandle = GLES20.glGetUniformLocation(program, "uAlpha")
  private val samplerHandle = GLES20.glGetUniformLocation(program, "sTexture")

  private val vertexBuffer = makeBuffer(QUAD_COORDS)
  private val texCoordBuffer = makeBuffer(QUAD_TEX_COORDS)

  fun createTexture(): Int {
    val textures = IntArray(1)
    GLES20.glGenTextures(1, textures, 0)
    val texId = textures[0]
    GLES20.glBindTexture(textureTarget, texId)
    GLES20.glTexParameteri(textureTarget, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(textureTarget, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(textureTarget, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(textureTarget, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    return texId
  }

  fun draw(mvpMatrix: FloatArray, texMatrix: FloatArray, texId: Int, keyColor: List<Float>, threshold: Float, smoothing: Float, alpha: Float) {
    GLES20.glUseProgram(program)

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(textureTarget, texId)
    GLES20.glUniform1i(samplerHandle, 0)

    GLES20.glUniformMatrix4fv(mvpMatrixHandle, 1, false, mvpMatrix, 0)
    GLES20.glUniformMatrix4fv(texMatrixHandle, 1, false, texMatrix, 0)
    GLES20.glUniform3f(keyColorHandle, keyColor.getOrElse(0) { 0.06f }, keyColor.getOrElse(1) { 0.72f }, keyColor.getOrElse(2) { 0.2f })
    GLES20.glUniform1f(thresholdHandle, threshold)
    GLES20.glUniform1f(smoothingHandle, smoothing)
    GLES20.glUniform1f(alphaHandle, alpha)

    vertexBuffer.position(0)
    GLES20.glEnableVertexAttribArray(positionHandle)
    GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)

    texCoordBuffer.position(0)
    GLES20.glEnableVertexAttribArray(texCoordHandle)
    GLES20.glVertexAttribPointer(texCoordHandle, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(positionHandle)
    GLES20.glDisableVertexAttribArray(texCoordHandle)
    GLES20.glBindTexture(textureTarget, 0)
  }

  companion object {
    private fun loadShader(type: Int, src: String): Int {
      val shader = GLES20.glCreateShader(type)
      GLES20.glShaderSource(shader, src)
      GLES20.glCompileShader(shader)
      val status = IntArray(1)
      GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
      if (status[0] == 0) {
        val log = GLES20.glGetShaderInfoLog(shader)
        GLES20.glDeleteShader(shader)
        throw RuntimeException("Chroma shader compile failed: $log")
      }
      return shader
    }

    private fun createProgram(vertexSrc: String, fragmentSrc: String): Int {
      val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexSrc)
      val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)
      val program = GLES20.glCreateProgram()
      GLES20.glAttachShader(program, vertexShader)
      GLES20.glAttachShader(program, fragmentShader)
      GLES20.glLinkProgram(program)
      val status = IntArray(1)
      GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0)
      if (status[0] == 0) {
        val log = GLES20.glGetProgramInfoLog(program)
        GLES20.glDeleteProgram(program)
        throw RuntimeException("Chroma program link failed: $log")
      }
      return program
    }
  }
}
