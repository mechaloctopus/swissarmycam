import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

/**
 * KIRI Engine cloud reconstruction client: video in → 3D Gaussian Splat out.
 * This is the one feature in Lensii that talks to a server, and it only does
 * so when the user explicitly starts a reconstruction — the API key lives in
 * local storage, entered by the user in Settings (get one at kiriengine.app).
 *
 * Flow: uploadVideo() → serialize id → poll getStatus() (~7–20 min) →
 * downloadResult() saves the model zip locally → the splat viewer opens it.
 */

const API_BASE = "https://api.kiriengine.app/api/v1/open";
const KEY_STORAGE = "lensii.nerf.apiKey";
const JOBS_STORAGE = "lensii.nerf.jobs";
const SPLATS_DIR = (FileSystem.documentDirectory ?? "") + "splats/";

export type NerfJobStatus = "processing" | "done" | "failed" | "downloaded";

export type NerfJob = {
  serialize: string;
  name: string;
  createdAt: number;
  status: NerfJobStatus;
  /** Local path of the downloaded model zip, once fetched. */
  localZip?: string;
};

export async function getApiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEY_STORAGE, key.trim());
}

export async function listJobs(): Promise<NerfJob[]> {
  try {
    const raw = await AsyncStorage.getItem(JOBS_STORAGE);
    return raw ? (JSON.parse(raw) as NerfJob[]) : [];
  } catch {
    return [];
  }
}

async function saveJobs(jobs: NerfJob[]): Promise<void> {
  await AsyncStorage.setItem(JOBS_STORAGE, JSON.stringify(jobs));
}

export async function removeJob(serialize: string): Promise<void> {
  const jobs = await listJobs();
  const job = jobs.find((j) => j.serialize === serialize);
  if (job?.localZip) {
    await FileSystem.deleteAsync(job.localZip, { idempotent: true }).catch(() => {});
  }
  await saveJobs(jobs.filter((j) => j.serialize !== serialize));
}

/**
 * Uploads a video for 3DGS reconstruction. KIRI's limits: ≤1080p, ≤3 min.
 * Uses FileSystem.uploadAsync (multipart) so a large video streams from disk
 * instead of being read into JS memory.
 */
export async function uploadVideo(videoUri: string, name: string): Promise<NerfJob> {
  const key = await getApiKey();
  if (!key) throw new Error("Add your KIRI Engine API key in Settings first");

  const res = await FileSystem.uploadAsync(`${API_BASE}/3dgs/video`, videoUri, {
    httpMethod: "POST",
    headers: { Authorization: `Bearer ${key}` },
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "videoFile",
  });
  const body = JSON.parse(res.body ?? "{}");
  if (!body?.ok || !body?.data?.serialize) {
    throw new Error(body?.msg ? `KIRI: ${body.msg}` : `Upload failed (HTTP ${res.status})`);
  }

  const job: NerfJob = {
    serialize: body.data.serialize,
    name,
    createdAt: Date.now(),
    status: "processing",
  };
  const jobs = await listJobs();
  await saveJobs([job, ...jobs]);
  return job;
}

/**
 * KIRI model status codes: 0 processing, 1 failed, 2 successful, 3 queuing,
 * 4 expired. Anything unknown is treated as still-processing rather than
 * failed, so a new server-side code can't spook the UI into giving up.
 */
export async function refreshJobStatus(job: NerfJob): Promise<NerfJob> {
  const key = await getApiKey();
  if (!key) return job;
  const res = await fetch(`${API_BASE}/model/getStatus?serialize=${encodeURIComponent(job.serialize)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => null);
  const code = body?.data?.status;
  let status: NerfJobStatus = job.status;
  if (code === 2) status = "done";
  else if (code === 1 || code === 4) status = "failed";
  else if (code === 0 || code === 3) status = "processing";

  const next = { ...job, status: job.status === "downloaded" ? "downloaded" as const : status };
  const jobs = await listJobs();
  await saveJobs(jobs.map((j) => (j.serialize === job.serialize ? next : j)));
  return next;
}

/** Fetches the model zip download link, then saves the zip locally. */
export async function downloadResult(job: NerfJob): Promise<NerfJob> {
  const key = await getApiKey();
  if (!key) throw new Error("Add your KIRI Engine API key in Settings first");

  const res = await fetch(`${API_BASE}/model/getModelZip?serialize=${encodeURIComponent(job.serialize)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => null);
  const url: string | undefined = body?.data?.modelUrl ?? body?.data?.url;
  if (!url) throw new Error(body?.msg ? `KIRI: ${body.msg}` : "No download link returned");

  await FileSystem.makeDirectoryAsync(SPLATS_DIR, { intermediates: true }).catch(() => {});
  const dest = `${SPLATS_DIR}${job.serialize}.zip`;
  const dl = await FileSystem.downloadAsync(url, dest);
  if (dl.status !== 200) throw new Error(`Download failed (HTTP ${dl.status})`);

  const next: NerfJob = { ...job, status: "downloaded", localZip: dest };
  const jobs = await listJobs();
  await saveJobs(jobs.map((j) => (j.serialize === job.serialize ? next : j)));
  return next;
}
