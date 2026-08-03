package expo.modules.videoexporter

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

class VideoExporterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoExporter")

    Function("isAvailable") { true }

    AsyncFunction("exportVideo") { outputPath: String, layersJson: String, canvasWidth: Int, canvasHeight: Int, clipsJson: String, audiosJson: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        VideoExportEngine(context).export(outputPath, layersJson, canvasWidth, canvasHeight, clipsJson, audiosJson)
        promise.resolve(outputPath)
      } catch (e: Exception) {
        promise.reject("EXPORT_FAILED", e.message ?: "Video export failed", e)
      }
    }

    AsyncFunction("exportImageSequence") { urisJson: String, fps: Int, outputPath: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        val arr = JSONArray(urisJson)
        val uris = (0 until arr.length()).map { arr.getString(it).removePrefix("file://") }
        ImageSequenceExporter(context).export(uris, fps, outputPath)
        promise.resolve(outputPath)
      } catch (e: Exception) {
        promise.reject("EXPORT_FAILED", e.message ?: "Image sequence export failed", e)
      }
    }
  }
}
