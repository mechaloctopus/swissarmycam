import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

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
