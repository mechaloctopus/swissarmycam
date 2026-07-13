package expo.modules.videoexporter

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VideoExporterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoExporter")

    Function("isAvailable") { true }

    AsyncFunction("exportVideo") { videoPath: String, outputPath: String, layersJson: String, canvasWidth: Int, canvasHeight: Int, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        VideoExportEngine(context).export(videoPath.removePrefix("file://"), outputPath, layersJson, canvasWidth, canvasHeight)
        promise.resolve(outputPath)
      } catch (e: Exception) {
        promise.reject("EXPORT_FAILED", e.message ?: "Video export failed", e)
      }
    }
  }
}
