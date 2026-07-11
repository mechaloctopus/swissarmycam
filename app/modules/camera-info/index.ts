import { requireNativeModule } from "expo-modules-core";

export type LensInfo = {
  id: string;
  facing: "back" | "front" | "external" | "unknown";
  hasFlash: boolean;
  focalLengthsMm: number[];
  apertures: number[];
  isoRange: [number, number] | null;
  exposureTimeRangeNs: [number, number] | null;
  physicalSizeMm: { width: number; height: number } | null;
  pixelArraySize: { width: number; height: number } | null;
  hardwareLevel: string;
};

type NativeCameraInfoModule = {
  getCharacteristics(): LensInfo[];
};

let native: NativeCameraInfoModule | null = null;
function getNative(): NativeCameraInfoModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativeCameraInfoModule>("CameraInfo");
  } catch {
    native = null;
  }
  return native;
}

/** Read-only Camera2 sensor characteristics for every camera on the device. Android only. */
export function getLensInfo(): LensInfo[] {
  const mod = getNative();
  if (!mod) return [];
  try {
    return mod.getCharacteristics();
  } catch {
    return [];
  }
}
