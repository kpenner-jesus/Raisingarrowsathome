// POST /api/portal/receipts — recipient submits a receipt record after uploading the file.
//
// Security: image_path MUST be inside the caller's own auth.uid() folder.
// Recipients cannot reference another recipient's storage object.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

const MAX_RECEIPT_AMOUNT = 50_000;            // $CAD upper bound (sanity)
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: recipient } = await supabase
    .from("recipients").select("id").eq("profile_id", user.id).maybeSingle();
  if (!recipient) return new NextResponse("no recipient linked to this account", { status: 400 });

  const { image_path, amount, purchase_date, description } = await req.json().catch(() => ({} as any));

  if (typeof image_path !== "string" || !image_path) {
    return new NextResponse("image_path required", { status: 400 });
  }
  // Enforce that path lives inside the caller's own folder. Storage RLS also
  // enforces this on the upload itself, but we re-check on the row insert.
  if (!image_path.startsWith(`${user.id}/`)) {
    return new NextResponse("image_path must be inside your own folder", { status: 400 });
  }
  // Reject path traversal characters.
  if (image_path.includes("..") || image_path.includes("\\") || image_path.includes("\0")) {
    return new NextResponse("invalid image_path", { status: 400 });
  }
  // Extension allowlist.
  const ext = image_path.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.includes(ext)) {
    return new NextResponse(`extension not allowed (must be one of ${ALLOWED_EXTS.join(", ")})`, { status: 400 });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return new NextResponse("amount must be a positive number", { status: 400 });
  }
  if (numericAmount > MAX_RECEIPT_AMOUNT) {
    return new NextResponse(`amount exceeds maximum (${MAX_RECEIPT_AMOUNT})`, { status: 400 });
  }

  const { data, error } = await supabase
    .from("receipts")
    .insert({
      recipient_id: recipient.id,
      image_path,
      amount: numericAmount,
      purchase_date: purchase_date || null,
      description: typeof description === "string" ? description.slice(0, 500) : null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id });
}
