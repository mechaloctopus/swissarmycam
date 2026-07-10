import * as FileSystem from "expo-file-system/legacy";

/**
 * Local-first capture storage. Everything lives in the app's private document
 * directory by default — private by default, matching the product's ethics.
 * "Save to Photos" is an explicit, separate action (see media.ts).
 */
const ROOT = (FileSystem.documentDirectory ?? "") + "captures/";
const TL_ROOT = (FileSystem.documentDirectory ?? "") + "timelapse/";

async function ensure(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export async function saveCapture(uri: string): Promise<string> {
  await ensure(ROOT);
  const dest = `${ROOT}sac_${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

export async function listCaptures(): Promise<string[]> {
  await ensure(ROOT);
  const files = await FileSystem.readDirectoryAsync(ROOT);
  return files
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .reverse()
    .map((f) => ROOT + f);
}

export async function deleteCapture(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function countCaptures(): Promise<number> {
  await ensure(ROOT);
  const files = await FileSystem.readDirectoryAsync(ROOT);
  return files.filter((f) => f.endsWith(".jpg")).length;
}

/* ---- Timelapse frame sets ---- */
export function newTimelapseSession(): string {
  return `tl_${Date.now()}`;
}

export async function saveTimelapseFrame(session: string, uri: string, index: number): Promise<string> {
  const dir = `${TL_ROOT}${session}/`;
  await ensure(dir);
  const dest = `${dir}frame_${String(index).padStart(5, "0")}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

export async function listTimelapseSessions(): Promise<{ session: string; frames: number; cover: string | null }[]> {
  await ensure(TL_ROOT);
  const sessions = await FileSystem.readDirectoryAsync(TL_ROOT);
  const out: { session: string; frames: number; cover: string | null }[] = [];
  for (const s of sessions.sort().reverse()) {
    const dir = `${TL_ROOT}${s}/`;
    try {
      const frames = (await FileSystem.readDirectoryAsync(dir)).filter((f) => f.endsWith(".jpg")).sort();
      out.push({ session: s, frames: frames.length, cover: frames.length ? dir + frames[0] : null });
    } catch {
      // ignore unreadable session dirs
    }
  }
  return out;
}
