import { NextResponse } from "next/server";
import { prepareClientMediaUpload } from "@/lib/pastes";
import { PASTE_MAX_MEDIA_BYTES } from "@/lib/pasteLimits";

type Body = {
  filename?: unknown;
  mimeType?: unknown;
  size?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : NaN;

  if (!filename || !mimeType || !Number.isFinite(size)) {
    return jsonError("filename, mimeType, and size are required.", 400);
  }

  if (size > PASTE_MAX_MEDIA_BYTES) {
    return jsonError(
      `File must be ${PASTE_MAX_MEDIA_BYTES / (1024 * 1024)}MB or smaller.`,
      413,
    );
  }

  if (size <= 0) {
    return jsonError("File size must be greater than zero.", 400);
  }

  try {
    const result = await prepareClientMediaUpload({ filename, mimeType, size });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "STORAGE_NOT_CONFIGURED") {
      return jsonError(
        "Media uploads are not configured (Supabase URL and service role key required).",
        503,
      );
    }
    if (err instanceof Error && err.message === "UNSUPPORTED_MEDIA_TYPE") {
      return jsonError(
        "Only common photo and video types are allowed (JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, MOV).",
        415,
      );
    }
    if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
      return jsonError(
        `File must be ${PASTE_MAX_MEDIA_BYTES / (1024 * 1024)}MB or smaller.`,
        413,
      );
    }
    if (err instanceof Error && err.message === "EMPTY_FILE") {
      return jsonError("File size must be greater than zero.", 400);
    }
    if (err instanceof Error && err.message === "COULD_NOT_ALLOCATE_ID") {
      return jsonError("Could not reserve an upload id. Try again.", 503);
    }
    throw err;
  }
}
