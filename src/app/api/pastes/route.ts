import { NextResponse } from "next/server";
import { createPaste } from "@/lib/pastes";

type CreatePasteBody = {
  content?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CreatePasteBody;
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json(
      { error: "Paste content is required." },
      { status: 400 },
    );
  }

  if (content.length > 5000) {
    return NextResponse.json(
      { error: "Paste content must be 5000 characters or less." },
      { status: 400 },
    );
  }

  const paste = await createPaste(content);
  return NextResponse.json({
    id: paste.id,
    expiresAt: paste.expiresAt,
  });
}
