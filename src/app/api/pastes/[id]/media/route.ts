import { NextResponse } from "next/server";
import {
  cleanupMediaFilesIfOrphaned,
  getPaste,
  mediaObjectPath,
} from "@/lib/pastes";
import { createPasteMediaSignedUrl } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const paste = await getPaste(id);

  if (!paste) {
    await cleanupMediaFilesIfOrphaned(id);
    return new NextResponse("Not found.", { status: 404 });
  }

  if (paste.kind !== "media") {
    return new NextResponse("Not a media paste.", { status: 404 });
  }

  const objectPath = mediaObjectPath(paste);
  if (!objectPath) {
    await cleanupMediaFilesIfOrphaned(id);
    return new NextResponse("Not found.", { status: 404 });
  }

  const signedUrl = await createPasteMediaSignedUrl(objectPath, 3600);
  if (!signedUrl) {
    return new NextResponse("Storage unavailable.", { status: 503 });
  }

  return NextResponse.redirect(signedUrl, 302);
}
