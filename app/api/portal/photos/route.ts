// POST /api/portal/photos — recipient submits a photo record after upload.
//
// Security: image_path MUST be inside the caller's own auth.uid() folder.
// Impersonation: when an admin is viewing as the test grantee, the photo
// is attached to the test recipient via service-role.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";

const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const ctx = await getEffectiveRecipient(user.id);
  const recipient = ctx.recipient;
  if (!recipient) return new NextResponse("no recipient", { status: 400 });

  const { image_path, caption } = await req.json().catch(() => ({} as any));
  if (typeof image_path !== "string" || !image_path) {
    return new NextResponse("image_path required", { status: 400 });
  }
  if (!image_path.startsWith(`${user.id}/`)) {
    return new NextResponse("image_path must be inside your own folder", { status: 400 });
  }
  if (image_path.includes("..") || image_path.includes("\\") || image_path.includes("\0")) {
    return new NextResponse("invalid image_path", { status: 400 });
  }
  const ext = image_path.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.includes(ext)) {
    return new NextResponse(`extension not allowed (must be one of ${ALLOWED_EXTS.join(", ")})`, { status: 400 });
  }

  const writeClient = ctx.mode === "impersonating" ? supabaseService() : supabase;
  const { error } = await writeClient.from("photos").insert({
    recipient_id: recipient.id,
    image_path,
    caption: typeof caption === "string" ? caption.slice(0, 300).trim() || null : null,
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
