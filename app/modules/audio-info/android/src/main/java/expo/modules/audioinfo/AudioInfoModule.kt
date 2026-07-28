package expo.modules.audioinfo

import android.content.Context
import android.media.AudioManager
import android.media.MicrophoneInfo
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Real device microphone inventory via AudioManager.getMicrophones() —
 * read-only hardware enumeration, no permission required (same category of
 * call as CameraManager.getCameraCharacteristics in camera-info).
 *
 * Honesty note baked into what this returns, not just docs: most phones
 * report exactly one microphone here even when they physically have several,
 * because Android's audio HAL handles multi-mic beamforming/selection
 * internally and doesn't expose the individual physical mics to apps unless
 * the device/OEM specifically does. This module reports exactly what the
 * device tells Android — never fabricates entries the OS doesn't report.
 */
class AudioInfoModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AudioInfo")

    Function("getMicrophones") {
      readMicrophones()
    }
  }

  private fun readMicrophones(): List<Map<String, Any?>> {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: return emptyList()

    val mics = try {
      manager.microphones
    } catch (e: Exception) {
      return emptyList()
    }

    return mics.map { mic ->
      val position = try {
        mic.position
      } catch (e: Exception) {
        null
      }

      mapOf(
        "id" to mic.id,
        "type" to describeType(mic.type),
        "location" to describeLocation(mic.location),
        "directionality" to describeDirectionality(mic.directionality),
        "group" to mic.group,
        "indexInGroup" to mic.indexInTheGroup,
        "position" to position?.let {
          mapOf("x" to it.x.toDouble(), "y" to it.y.toDouble(), "z" to it.z.toDouble())
        }
      )
    }
  }

  private fun describeType(type: Int): String = when (type) {
    android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC -> "built-in mic"
    android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset mic"
    android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth mic"
    android.media.AudioDeviceInfo.TYPE_USB_DEVICE, android.media.AudioDeviceInfo.TYPE_USB_HEADSET -> "USB mic"
    else -> "unknown ($type)"
  }

  private fun describeLocation(location: Int): String = when (location) {
    MicrophoneInfo.LOCATION_MAINBODY -> "main body"
    MicrophoneInfo.LOCATION_MAINBODY_MOVABLE -> "main body (movable)"
    MicrophoneInfo.LOCATION_PERIPHERAL -> "peripheral"
    else -> "unknown"
  }

  private fun describeDirectionality(directionality: Int): String = when (directionality) {
    MicrophoneInfo.DIRECTIONALITY_OMNI -> "omnidirectional"
    MicrophoneInfo.DIRECTIONALITY_BI_DIRECTIONAL -> "bidirectional"
    MicrophoneInfo.DIRECTIONALITY_CARDIOID -> "cardioid"
    MicrophoneInfo.DIRECTIONALITY_HYPER_CARDIOID -> "hypercardioid"
    MicrophoneInfo.DIRECTIONALITY_SUPER_CARDIOID -> "supercardioid"
    else -> "unknown"
  }
}
