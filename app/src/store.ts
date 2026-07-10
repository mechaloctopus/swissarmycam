import * as FileSystem from "expo-file-system/legacy";

/**
 * Local-first capture storage. Photos and videos live in the app's private
 * document directory by default — private by default. "Save to Photos" is a
 * separate, explicit action (see media.ts).
 */
const ROOT = (FileSystem.documentDirectory ?? "") + "captures/";
const TL_ROOT = (FileSystem.documentDirectory ?? "") + "timelapse/";

export type MediaKind = "photo" | "video";
export type MediaItem = { uri: string; kind: MediaKind; name: string };

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

export async function saveVideo(uri: string): Promise<string> {
  await ensure(ROOT);
  const dest = `${ROOT}sac_${Date.now()}.mp4`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

export async function listMedia(): Promise<MediaItem[]> {
  await ensure(ROOT);
  const files = await FileSystem.readDirectoryAsync(ROOT);
  return files
    .filter((f) => f.endsWith(".jpg") || f.endsWith(".mp4"))
    .sort()
    .reverse()
    .map((f) => ({ uri: ROOT + f, kind: f.endsWith(".mp4") ? "video" : "photo", name: f } as MediaItem));
}

export async function deleteMedia(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function countMedia(): Promise<{ photos: number; videos: number }> {
  const items = await listMedia();
  return { photos: items.filter((i) => i.kind === "photo").length, videos: items.filter((i) => i.kind === "video").length };
}

/** Total bytes used by in-app captures + timelapse sets. */
export async function storageBytes(): Promise<number> {
  let total = 0;
  for (const root of [ROOT, TL_ROOT]) {
    try {
      await ensure(root);
      const walk = async (dir: string) => {
        const entries = await FileSystem.readDirectoryAsync(dir);
        for (const e of entries) {
          const info = await FileSystem.getInfoAsync(dir + e);
          if (info.exists && info.isDirectory) await walk(dir + e + "/");
          else if (info.exists && typeof info.size === "number") total += info.size;
        }
      };
      await walk(root);
    } catch {
      // ignore
    }
  }
  return total;
}

export async function clearAllCaptures(): Promise<void> {
  await FileSystem.deleteAsync(ROOT, { idempotent: true });
  await FileSystem.deleteAsync(TL_ROOT, { idempotent: true });
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

export type TLSession = { session: string; frames: string[]; cover: string | null };

export async function listTimelapseSessions(): Promise<TLSession[]> {
  await ensure(TL_ROOT);
  const sessions = await FileSystem.readDirectoryAsync(TL_ROOT);
  const out: TLSession[] = [];
  for (const s of sessions.sort().reverse()) {
    const dir = `${TL_ROOT}${s}/`;
    try {
      const frames = (await FileSystem.readDirectoryAsync(dir)).filter((f) => f.endsWith(".jpg")).sort().map((f) => dir + f);
      out.push({ session: s, frames, cover: frames.length ? frames[0] : null });
    } catch {
      // ignore unreadable session dirs
    }
  }
  return out;
}

export async function deleteTimelapseSession(session: string): Promise<void> {
  await FileSystem.deleteAsync(`${TL_ROOT}${session}/`, { idempotent: true });
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
