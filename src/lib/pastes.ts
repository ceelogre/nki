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
  const store = await readStore();
  cleanupExpired(store);
  let id = randomId();
  while (store[id]) {
    id = randomId();
  }

  const createdAt = Date.now();
  const record: PasteRecord = {
    content,
    createdAt,
    expiresAt: createdAt + PASTE_TTL_MS,
  };
  store[id] = record;
  await writeStore(store);

  return { id, ...record };
}

export async function getPaste(id: string) {
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
