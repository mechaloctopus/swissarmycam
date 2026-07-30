import { requireNativeModule } from "expo-modules-core";

type NativeVideoExporterModule = {
  isAvailable(): boolean;
  exportVideo(
    outputPath: string,
    layersJson: string,
    canvasWidth: number,
    canvasHeight: number,
    clipsJson: string
  ): Promise<string>;
  exportImageSequence(urisJson: string, fps: number, outputPath: string): Promise<string>;
};

let native: NativeVideoExporterModule | null = null;
function getNative(): NativeVideoExporterModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativeVideoExporterModule>("VideoExporter");
  } catch {
    native = null;
  }
  return native;
}

/** Android only — false on any other platform or if linking somehow failed. */
export function isVideoExportAvailable(): boolean {
  try {
    return getNative()?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/**
 * Bakes the Studio timeline into a new MP4 via a native MediaCodec decode →
 * GLES composite → MediaCodec encode pipeline — a real re-encode, not a screen
 * capture. Every layer is drawn at its interpolated keyframe pose for that
 * frame's exact timestamp, respecting its in/out window and fades.
 *
 * `layersJson` and `clipsJson` must come from serializeLayers()/serializeClips()
 * in src/timeline.ts so the field names line up with LayerParser.kt. Clips play
 * back to back, each with its own trim/speed and optional dip transition. `canvasWidth`/`canvasHeight` are the
 * on-screen preview size the keyframes were authored against, so the native
 * side can map preview-space coordinates onto the video's pixel space.
 *
 * `outputPath` must be a plain filesystem path (no `file://` prefix).
 */
export async function exportTimeline(
  outputPath: string,
  layersJson: string,
  clipsJson: string,
  canvasWidth: number,
  canvasHeight: number
): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("Video export is not available on this build");
  return mod.exportVideo(outputPath, layersJson, Math.round(canvasWidth), Math.round(canvasHeight), clipsJson);
}

/**
 * Bakes a sequence of still images (e.g. a claymation/stop-motion frame set)
 * into an MP4 at a fixed frame rate — no decode step, just each frame drawn
 * straight to the encoder. `outputPath` must be a plain filesystem path.
 */
export async function exportImageSequence(frameUris: string[], fps: number, outputPath: string): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("Video export is not available on this build");
  return mod.exportImageSequence(JSON.stringify(frameUris), Math.round(fps), outputPath);
}
