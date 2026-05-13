import { NextResponse } from "next/server";
import { completeClientMediaUpload } from "@/lib/pastes";

type Body = {
  id?: unknown;
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

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return jsonError("id is required.", 400);
  }

  try {
    const result = await completeClientMediaUpload(id);
    switch (result.status) {
      case "ok":
        return NextResponse.json({
          id: result.id,
          expiresAt: result.expiresAt,
          kind: "media" as const,
        });
      case "not_found":
        return jsonError("Unknown or expired upload session.", 404);
      case "incomplete":
        return jsonError(
          "File was not uploaded yet or is still processing. Wait a moment and try again.",
          400,
        );
      case "too_large":
        return jsonError("Uploaded file exceeds the maximum allowed size.", 413);
      default:
        return jsonError("Unable to complete upload.", 500);
    }
  } catch (err) {
    if (err instanceof Error && err.message === "STORAGE_NOT_CONFIGURED") {
      return jsonError("Storage is not configured.", 503);
    }
    throw err;
  }
}
