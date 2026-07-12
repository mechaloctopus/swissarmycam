import { requireNativeModule } from "expo-modules-core";

type NativeScreenRecorderModule = {
  isRecording(): boolean;
  startRecording(outputPath: string, withMic: boolean): Promise<boolean>;
  stopRecording(): Promise<string | null>;
};

let native: NativeScreenRecorderModule | null = null;
function getNative(): NativeScreenRecorderModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativeScreenRecorderModule>("ScreenRecorder");
  } catch {
    native = null;
  }
  return native;
}

/** Android only — false on any other platform or if linking somehow failed. */
export function isScreenRecorderAvailable(): boolean {
  return getNative() !== null;
}

export function isRecording(): boolean {
  return getNative()?.isRecording() ?? false;
}

/**
 * Starts screen recording. Shows the system's own screen-share consent
 * dialog first — required every session on Android 14+, and not something
 * this app can skip or pre-approve. Resolves false if the user declines,
 * the module isn't available, or a recording is already running.
 *
 * `outputPath` must be a plain filesystem path (no `file://` prefix).
 */
export async function startRecording(outputPath: string, withMic: boolean): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    return await mod.startRecording(outputPath, withMic);
  } catch {
    return false;
  }
}

/** Stops the active recording. Resolves the output file path, or null. */
export async function stopRecording(): Promise<string | null> {
  const mod = getNative();
  if (!mod) return null;
  try {
    return await mod.stopRecording();
  } catch {
    return null;
  }
}
