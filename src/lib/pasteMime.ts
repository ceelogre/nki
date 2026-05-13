const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const ALLOWED_MEDIA_TYPES = new Set(Object.keys(MIME_TO_EXT));

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function extname(filename: string) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export function mimeFromFilename(filename: string): string | null {
  return EXT_TO_MIME[extname(filename)] ?? null;
}

export function assertAllowedMediaType(mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_MEDIA_TYPES.has(normalized)) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }
  return normalized;
}

export function extensionForMime(mime: string) {
  return MIME_TO_EXT[mime] ?? "";
}

export function resolveMediaMimeFromFile(file: File): string {
  const declared = file.type?.trim() ?? "";
  const fallbackMime =
    declared && declared !== "application/octet-stream"
      ? declared
      : mimeFromFilename(file.name) ?? "";
  return assertAllowedMediaType(fallbackMime || "application/octet-stream");
}
