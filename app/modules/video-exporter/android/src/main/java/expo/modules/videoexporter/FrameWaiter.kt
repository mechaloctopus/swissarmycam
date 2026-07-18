package expo.modules.videoexporter

import android.graphics.SurfaceTexture

/**
 * Signals when a decoded frame has landed in a SurfaceTexture. The listener
 * fires on a HandlerThread (SurfaceTexture requires a Looper thread to
 * deliver it); the decode loop polls the volatile flag rather than using
 * Object.wait/notify, to keep this free of any Kotlin/Java Object-monitor
 * interop ambiguity. Shared by the base video decode loop and every
 * per-layer OverlayVideoDecoder.
 */
class FrameWaiter : SurfaceTexture.OnFrameAvailableListener {
  @Volatile private var available = false

  override fun onFrameAvailable(surfaceTexture: SurfaceTexture) {
    available = true
  }

  fun await(timeoutMs: Long) {
    var waited = 0L
    while (!available && waited < timeoutMs) {
      Thread.sleep(5)
      waited += 5
    }
    available = false
  }
}
