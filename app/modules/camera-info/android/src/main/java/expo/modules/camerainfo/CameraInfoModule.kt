package expo.modules.camerainfo

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Read-only Camera2 sensor characteristics. Does not open a capture session and
 * does not require the CAMERA permission — CameraManager.getCameraCharacteristics
 * is a hardware-enumeration call available to any app on Android.
 */
class CameraInfoModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CameraInfo")

    Function("getCharacteristics") {
      readCharacteristics()
    }
  }

  private fun readCharacteristics(): List<Map<String, Any?>> {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      ?: return emptyList()

    val result = mutableListOf<Map<String, Any?>>()
    val ids = try {
      manager.cameraIdList
    } catch (e: Exception) {
      return emptyList()
    }

    for (id in ids) {
      try {
        val c = manager.getCameraCharacteristics(id)

        val facing = when (c.get(CameraCharacteristics.LENS_FACING)) {
          CameraCharacteristics.LENS_FACING_BACK -> "back"
          CameraCharacteristics.LENS_FACING_FRONT -> "front"
          CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
          else -> "unknown"
        }

        val hasFlash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false

        val focalLengths = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
          ?.map { it.toDouble() } ?: emptyList()

        val apertures = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)
          ?.map { it.toDouble() } ?: emptyList()

        val isoRange = c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
          ?.let { listOf(it.lower, it.upper) }

        val exposureRange = c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
          ?.let { listOf(it.lower, it.upper) }

        val physicalSize = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
          ?.let { mapOf("width" to it.width.toDouble(), "height" to it.height.toDouble()) }

        val pixelArray = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
          ?.let { mapOf("width" to it.width, "height" to it.height) }

        val hardwareLevel = when (c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) {
          CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "legacy"
          CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "limited"
          CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "full"
          CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "level_3"
          CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "external"
          else -> "unknown"
        }

        result.add(
          mapOf(
            "id" to id,
            "facing" to facing,
            "hasFlash" to hasFlash,
            "focalLengthsMm" to focalLengths,
            "apertures" to apertures,
            "isoRange" to isoRange,
            "exposureTimeRangeNs" to exposureRange,
            "physicalSizeMm" to physicalSize,
            "pixelArraySize" to pixelArray,
            "hardwareLevel" to hardwareLevel
          )
        )
      } catch (e: Exception) {
        // Skip a camera ID we can't read characteristics for; never crash the app for this.
        continue
      }
    }
    return result
  }
}
