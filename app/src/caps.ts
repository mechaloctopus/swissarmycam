import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Device camera capabilities detected at runtime (from the live CameraView) and
 * cached so the Settings screen can offer real, device-accurate options.
 */
const KEY = "sac.caps.pictureSizes.v1";

export async function savePictureSizes(sizes: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // ignore
  }
}

export async function loadPictureSizes(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Sort "WxH" descending by pixel count for a tidy picker. */
export function sortSizes(sizes: string[]): string[] {
  const px = (s: string) => {
    const [w, h] = s.split("x").map((n) => parseInt(n, 10));
    return (w || 0) * (h || 0);
  };
  return [...new Set(sizes)].sort((a, b) => px(b) - px(a));
}
