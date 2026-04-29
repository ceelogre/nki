const PASTE_TTL_MS = 24 * 60 * 60 * 1000;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 6;

type PasteRecord = {
  content: string;
  createdAt: number;
  expiresAt: number;
};

const pasteStore = new Map<string, PasteRecord>();

function randomId() {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ID_CHARS.length);
    id += ID_CHARS[index];
  }
  return id;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, paste] of pasteStore.entries()) {
    if (paste.expiresAt <= now) {
      pasteStore.delete(id);
    }
  }
}

export function createPaste(content: string) {
  cleanupExpired();
  let id = randomId();
  while (pasteStore.has(id)) {
    id = randomId();
  }

  const createdAt = Date.now();
  const record: PasteRecord = {
    content,
    createdAt,
    expiresAt: createdAt + PASTE_TTL_MS,
  };
  pasteStore.set(id, record);

  return { id, ...record };
}

export function getPaste(id: string) {
  cleanupExpired();
  const paste = pasteStore.get(id);
  if (!paste) {
    return null;
  }
  return { id, ...paste };
}

export function getPasteTtlHours() {
  return PASTE_TTL_MS / (60 * 60 * 1000);
}
