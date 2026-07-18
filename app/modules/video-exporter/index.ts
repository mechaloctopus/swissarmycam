import { requireNativeModule } from "expo-modules-core";

export type ExportKeyframe = { t: number; x: number; y: number; scale: number; rotation: number; opacity: number };
export type ExportLayer = {
  kind: "image" | "text" | "video";
  uri?: string | null;
  text?: string | null;
  color: string;
  keyframes: ExportKeyframe[];
  /** "video" layers only — chroma key params for compositing a green/blue-screen clip. */
  keyColor?: [number, number, number];
  threshold?: number;
  smoothing?: number;
};

type NativeVideoExporterModule = {
  isAvailable(): boolean;
  exportVideo(videoPath: string, outputPath: string, layersJson: string, canvasWidth: number, canvasHeight: number): Promise<string>;
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
 * Bakes keyframed overlay layers into the base video, frame-accurately, via a
 * native MediaCodec decode -> GLES composite -> MediaCodec encode pipeline —
 * a real re-encode, not a screen capture. `canvasWidth`/`canvasHeight` must be
 * the on-screen preview canvas size the keyframes were recorded against (the
 * Editor's `contentFit: "contain"` viewport), so the native side can map
 * preview-space coordinates onto the video's native pixel space.
 *
 * `outputPath` must be a plain filesystem path (no `file://` prefix).
 */
export async function exportOverlaidVideo(
  videoUri: string,
  outputPath: string,
  layers: ExportLayer[],
  canvasWidth: number,
  canvasHeight: number
): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("Video export is not available on this build");
  const layersJson = JSON.stringify(
    layers.map((l) => ({
      kind: l.kind,
      uri: l.uri ?? null,
      text: l.text ?? null,
      color: l.color,
      keyframes: l.keyframes,
      keyColor: l.keyColor ?? null,
      threshold: l.threshold ?? null,
      smoothing: l.smoothing ?? null,
    }))
  );
  return mod.exportVideo(videoUri, outputPath, layersJson, Math.round(canvasWidth), Math.round(canvasHeight));
}
