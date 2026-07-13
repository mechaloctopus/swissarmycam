package expo.modules.videoexporter

import android.opengl.EGLSurface
import android.view.Surface

/** An EGL window surface bound to a [Surface] (here, the encoder's input surface). */
class WindowSurface(private val eglCore: EglCore, surface: Surface) {
  private val eglSurface: EGLSurface = eglCore.createWindowSurface(surface)

  fun makeCurrent() = eglCore.makeCurrent(eglSurface)

  fun swapBuffers(): Boolean = eglCore.swapBuffers(eglSurface)

  fun setPresentationTime(nsecs: Long) = eglCore.setPresentationTime(eglSurface, nsecs)

  fun release() = eglCore.releaseSurface(eglSurface)
}
