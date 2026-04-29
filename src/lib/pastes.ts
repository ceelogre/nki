import { Redis } from "@upstash/redis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PASTE_TTL_MS = 24 * 60 * 60 * 1000;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 6;
const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "pastes.json");

type PasteRecord = {
  content: string;
  createdAt: number;
  expiresAt: number;
};

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

export async function createPaste(content: string) {


  const createdAt = Date.now();
  const record: PasteRecord = {
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
