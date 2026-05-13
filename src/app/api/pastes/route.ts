import { NextResponse } from "next/server";
import { createPaste } from "@/lib/pastes";
import { PASTE_MAX_TEXT_CHARS } from "@/lib/pasteLimits";

type CreatePasteBody = {
  content?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: CreatePasteBody;
  try {
    body = (await request.json()) as CreatePasteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return jsonError("Paste content is required.", 400);
  }

  if (content.length > PASTE_MAX_TEXT_CHARS) {
    return jsonError(
      `Paste content must be ${PASTE_MAX_TEXT_CHARS} characters or less.`,
      400,
    );
  }

  const paste = await createPaste(content);
  return NextResponse.json({
    id: paste.id,
    expiresAt: paste.expiresAt,
    kind: "text" as const,
  });
}
