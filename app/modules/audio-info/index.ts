import { requireNativeModule } from "expo-modules-core";

export type MicrophoneInfo = {
  id: number;
  type: string;
  location: string;
  directionality: string;
  group: number;
  indexInGroup: number;
  position: { x: number; y: number; z: number } | null;
};

type NativeAudioInfoModule = {
  getMicrophones(): MicrophoneInfo[];
};

let native: NativeAudioInfoModule | null = null;
function getNative(): NativeAudioInfoModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativeAudioInfoModule>("AudioInfo");
  } catch {
    native = null;
  }
  return native;
}

/**
 * Real device microphone inventory. Most phones report exactly one entry
 * here even with multiple physical mics — Android's audio HAL handles
 * beamforming/selection internally and doesn't expose individual mics to
 * apps unless the device specifically does. This reflects that honestly;
 * it never fabricates entries.
 */
export function getMicrophones(): MicrophoneInfo[] {
  try {
    return getNative()?.getMicrophones() ?? [];
  } catch {
    return [];
  }
}
