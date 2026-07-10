import * as MediaLibrary from "expo-media-library";

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
