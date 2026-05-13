import { Redis } from "@upstash/redis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PASTE_MAX_MEDIA_BYTES } from "@/lib/pasteLimits";
import {
  assertAllowedMediaType,
  extensionForMime,
  mimeFromFilename,
} from "@/lib/pasteMime";
import {
  createSignedUploadForObjectPath,
  getMediaBucket,
  getObjectByteSize,
  isStorageConfigured,
  removeObjectsForPasteId,
  removePasteObjects,
} from "@/lib/supabaseStorage";

const PASTE_TTL_MS = 24 * 60 * 60 * 1000;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 6;
const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "pastes.json");
const PENDING_MEDIA_FILE = path.join(STORE_DIR, "pending-media.json");
/** Matches Supabase signed upload URL lifetime (see storage-js docs). */
const PENDING_MEDIA_SEC = 2 * 60 * 60;
const PENDING_MEDIA_MS = PENDING_MEDIA_SEC * 1000;

type PendingMediaRecord = {
  storagePath: string;
  mimeType: string;
  originalName: string;
  expiresAt: number;
};

type PendingStore = Record<string, PendingMediaRecord>;

type PasteRecordBase = {
  createdAt: number;
  expiresAt: number;
};

export type TextPasteRecord = PasteRecordBase & {
  kind?: "text";
  content: string;
};

export type MediaPasteRecord = PasteRecordBase & {
  kind: "media";
  mimeType: string;
  originalName: string;
  /** Object path in the Supabase Storage bucket (bucket root). */
  storagePath?: string;
  /** Legacy local-disk filename; same role as storagePath when storagePath is absent. */
  storedName?: string;
};

type PasteRecord = TextPasteRecord | MediaPasteRecord;

type PasteStore = Record<string, PasteRecord>;

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null;

function randomId() {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ID_CHARS.length);
    id += ID_CHARS[index];
  }
  return id;
}

function cleanupExpired(store: PasteStore) {
  const now = Date.now();
  for (const [id, paste] of Object.entries(store)) {
    if (paste.expiresAt <= now) {
      if (paste.kind === "media") {
        const objectPath = paste.storagePath ?? paste.storedName;
        if (objectPath) {
          void removePasteObjects([objectPath]);
        } else {
          void removeObjectsForPasteId(id);
        }
      }
      delete store[id];
    }
  }
}

async function readStore(): Promise<PasteStore> {
  try {
    const raw = await readFile(STORE_FILE, { encoding: "utf-8", flag: "a+" });
    return JSON.parse(raw) as PasteStore;
  } catch {
    return {};
  }
}

async function writeStore(store: PasteStore) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store), "utf-8");
}

async function readPendingStore(): Promise<PendingStore> {
  try {
    const raw = await readFile(PENDING_MEDIA_FILE, "utf-8");
    return JSON.parse(raw) as PendingStore;
  } catch {
    return {};
  }
}

async function writePendingStore(pending: PendingStore) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(PENDING_MEDIA_FILE, JSON.stringify(pending), "utf-8");
}

function cleanupExpiredPending(pending: PendingStore) {
  const now = Date.now();
  for (const [id, row] of Object.entries(pending)) {
    if (row.expiresAt <= now) {
      void removePasteObjects([row.storagePath]);
      delete pending[id];
    }
  }
}

export async function createPaste(content: string) {
  const createdAt = Date.now();
  const record: TextPasteRecord = {
    content,
    createdAt,
    expiresAt: createdAt + PASTE_TTL_MS,
  };

   if (redis) {
    // Use atomic NX+EX to avoid id collisions in distributed/serverless runtimes.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomId();
      const created = await redis.set(`paste:${id}`, record, {
        nx: true,
        ex: Math.floor(PASTE_TTL_MS / 1000),
      });
      if (created) {
        return { id, ...record };
      }
    }
    throw new Error("Could not allocate unique paste id.");
  }
  const store = await readStore();
  cleanupExpired(store);
  let id = randomId();
  while (store[id]) {
    id = randomId();
  }
  store[id] = record;
  await writeStore(store);

  return { id, ...record };
}

export type PrepareClientMediaResult = {
  id: string;
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
};

export type CompleteClientMediaResult =
  | { status: "ok"; id: string; expiresAt: number }
  | { status: "not_found" }
  | { status: "incomplete" }
  | { status: "too_large" };

/**
 * Reserve an id and return a signed upload the browser can send the file to (bypasses small serverless body limits).
 */
export async function prepareClientMediaUpload(input: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<PrepareClientMediaResult> {
  if (!isStorageConfigured()) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }

  const declared = input.mimeType?.trim() ?? "";
  const fallbackMime =
    declared && declared !== "application/octet-stream"
      ? declared
      : mimeFromFilename(input.filename) ?? "";

  const mime = assertAllowedMediaType(fallbackMime || "application/octet-stream");
  const ext = extensionForMime(mime);
  if (!ext) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }

  if (input.size > PASTE_MAX_MEDIA_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
  if (input.size <= 0) {
    throw new Error("EMPTY_FILE");
  }

  const safeName = path
    .basename(input.filename || "upload")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 180);
  const expiresAt = Date.now() + PENDING_MEDIA_MS;
  const bucket = getMediaBucket();

  if (redis) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const id = randomId();
      const pasteExists = await redis.exists(`paste:${id}`);
      const pendingExists = await redis.exists(`pending_media:${id}`);
      if (pasteExists || pendingExists) {
        continue;
      }
      const storagePath = `${id}${ext}`;
      let signed: { signedUrl: string; token: string; path: string };
      try {
        signed = await createSignedUploadForObjectPath(storagePath);
      } catch {
        throw new Error("COULD_NOT_ALLOCATE_ID");
      }
      const pending: PendingMediaRecord = {
        storagePath,
        mimeType: mime,
        originalName: safeName || "upload",
        expiresAt,
      };
      const created = await redis.set(`pending_media:${id}`, pending, {
        nx: true,
        ex: PENDING_MEDIA_SEC,
      });
      if (created) {
        return {
          id,
          bucket,
          path: storagePath,
          token: signed.token,
          signedUrl: signed.signedUrl,
        };
      }
    }
    throw new Error("COULD_NOT_ALLOCATE_ID");
  }

  const store = await readStore();
  cleanupExpired(store);
  const pendingStore = await readPendingStore();
  cleanupExpiredPending(pendingStore);

  let id = randomId();
  let guard = 0;
  while ((store[id] || pendingStore[id]) && guard < 48) {
    id = randomId();
    guard += 1;
  }
  if (store[id] || pendingStore[id]) {
    throw new Error("COULD_NOT_ALLOCATE_ID");
  }

  const storagePath = `${id}${ext}`;
  let signed: { signedUrl: string; token: string; path: string };
  try {
    signed = await createSignedUploadForObjectPath(storagePath);
  } catch {
    throw new Error("COULD_NOT_ALLOCATE_ID");
  }

  pendingStore[id] = {
    storagePath,
    mimeType: mime,
    originalName: safeName || "upload",
    expiresAt,
  };
  await writePendingStore(pendingStore);

  return {
    id,
    bucket,
    path: storagePath,
    token: signed.token,
    signedUrl: signed.signedUrl,
  };
}

export async function completeClientMediaUpload(id: string): Promise<CompleteClientMediaResult> {
  if (!isStorageConfigured()) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }

  if (redis) {
    const existing = await redis.get<PasteRecord>(`paste:${id}`);
    if (existing?.kind === "media") {
      return { status: "ok", id, expiresAt: existing.expiresAt };
    }

    const pending = await redis.get<PendingMediaRecord>(`pending_media:${id}`);
    if (!pending) {
      return { status: "not_found" };
    }

    const bytes = await getObjectByteSize(pending.storagePath);
    if (bytes === null || bytes === 0) {
      return { status: "incomplete" };
    }
    if (bytes > PASTE_MAX_MEDIA_BYTES) {
      await removePasteObjects([pending.storagePath]);
      await redis.del(`pending_media:${id}`);
      return { status: "too_large" };
    }

    const createdAt = Date.now();
    const expiresAt = createdAt + PASTE_TTL_MS;
    const record: MediaPasteRecord = {
      kind: "media",
      mimeType: pending.mimeType,
      originalName: pending.originalName,
      storagePath: pending.storagePath,
      createdAt,
      expiresAt,
    };
    await redis.set(`paste:${id}`, record, { ex: Math.floor(PASTE_TTL_MS / 1000) });
    await redis.del(`pending_media:${id}`);
    return { status: "ok", id, expiresAt };
  }

  const store = await readStore();
  cleanupExpired(store);
  const pendingStore = await readPendingStore();
  cleanupExpiredPending(pendingStore);

  if (store[id]?.kind === "media") {
    const p = store[id] as MediaPasteRecord;
    await writePendingStore(pendingStore);
    await writeStore(store);
    return { status: "ok", id, expiresAt: p.expiresAt };
  }

  const pending = pendingStore[id];
  if (!pending) {
    await writePendingStore(pendingStore);
    await writeStore(store);
    return { status: "not_found" };
  }

  const bytes = await getObjectByteSize(pending.storagePath);
  if (bytes === null || bytes === 0) {
    await writePendingStore(pendingStore);
    await writeStore(store);
    return { status: "incomplete" };
  }
  if (bytes > PASTE_MAX_MEDIA_BYTES) {
    await removePasteObjects([pending.storagePath]);
    delete pendingStore[id];
    await writePendingStore(pendingStore);
    await writeStore(store);
    return { status: "too_large" };
  }

  const createdAt = Date.now();
  const expiresAt = createdAt + PASTE_TTL_MS;
  const record: MediaPasteRecord = {
    kind: "media",
    mimeType: pending.mimeType,
    originalName: pending.originalName,
    storagePath: pending.storagePath,
    createdAt,
    expiresAt,
  };
  delete pendingStore[id];
  store[id] = record;
  await writePendingStore(pendingStore);
  await writeStore(store);
  return { status: "ok", id, expiresAt };
}

export function mediaObjectPath(paste: MediaPasteRecord): string {
  return paste.storagePath ?? paste.storedName ?? "";
}

/** Best-effort cleanup when metadata is missing but objects may exist (e.g. Redis TTL). */
export async function cleanupMediaFilesIfOrphaned(pasteId: string) {
  await removeObjectsForPasteId(pasteId);
}

export async function getPaste(id: string) {
  if (redis) {
    const paste = await redis.get<PasteRecord>(`paste:${id}`);
    if (!paste) {
      return null;
    }
    return { id, ...paste };
  }
  const store = await readStore();
  cleanupExpired(store);
  const paste = store[id];
  await writeStore(store);

  if (!paste) {
    return null;
  }
  return { id, ...paste };
}

export function getPasteTtlHours() {
  return PASTE_TTL_MS / (60 * 60 * 1000);
}
