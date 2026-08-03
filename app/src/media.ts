import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

/**
 * Explicit "Save to Photos". Best-effort: if the user hasn't granted the
 * media permission we simply skip — the capture is already safe in-app.
 */
export async function saveToPhotos(uri: string): Promise<boolean> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) {
      const req = await MediaLibrary.requestPermissionsAsync();
      if (!req.granted) return false;
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

/** Share a capture via the OS share sheet. */
export async function shareFile(uri: string): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import an image from the device's photo library — e.g. a transparent PNG
 * overlay the user made elsewhere. Returns null if cancelled or denied.
 */
export async function pickImageFromLibrary(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch {
    return null;
  }
}

/**
 * Import a video from the device's photo library — e.g. a green-screen clip
 * to key and overlay in the Editor. Returns null if cancelled or denied.
 */
/**
 * Picks an audio file for the editor's audio tracks. Copied into the cache so
 * we hand the native side a real file:// path — MediaExtractor cannot open a
 * bare content:// URI by string.
 */
export async function pickAudioFile(): Promise<{ uri: string; name: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: "audio/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const a = res.assets?.[0];
  if (!a?.uri) return null;
  return { uri: a.uri, name: a.name ?? "Audio" };
}

export async function pickVideoFromLibrary(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "videos",
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0].uri;
  } catch {
    return null;
  }
}
