import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_MEDIA_BUCKET ?? "paste-media";

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

let adminClient: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient !== undefined) {
    return adminClient;
  }
  const env = getEnv();
  if (!env) {
    adminClient = null;
    return null;
  }
  adminClient = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export function getMediaBucket() {
  return BUCKET;
}

export function isStorageConfigured() {
  return getSupabaseAdmin() !== null;
}

export async function createSignedUploadForObjectPath(objectPath: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error || !data?.signedUrl || !data.token) {
    throw error ?? new Error("SIGNED_UPLOAD_FAILED");
  }
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  };
}

/** Byte length of an object at bucket root, or null if missing. */
export async function getObjectByteSize(objectPath: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return null;
  }
  const { data: exists, error: exErr } = await supabase.storage
    .from(BUCKET)
    .exists(objectPath);
  if (exErr || !exists) {
    return null;
  }
  const { data, error } = await supabase.storage.from(BUCKET).info(objectPath);
  if (error || !data) {
    return null;
  }
  if (typeof data.size === "number") {
    return data.size;
  }
  const meta = data.metadata as { size?: number } | undefined;
  if (meta && typeof meta.size === "number") {
    return meta.size;
  }
  return 0;
}

export async function removePasteObjects(paths: string[]) {
  const filtered = paths.filter(Boolean);
  if (filtered.length === 0) {
    return;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return;
  }
  await supabase.storage.from(BUCKET).remove(filtered);
}

/** Object keys are `{pasteId}{ext}` — remove all candidates when extension is unknown (orphans). */
const OBJECT_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
];

export async function removeObjectsForPasteId(pasteId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return;
  }
  const paths = OBJECT_EXTENSIONS.map((ext) => `${pasteId}${ext}`);
  await supabase.storage.from(BUCKET).remove(paths);
}

export async function createPasteMediaSignedUrl(objectPath: string, expiresInSec = 3600) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, expiresInSec);
  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}
