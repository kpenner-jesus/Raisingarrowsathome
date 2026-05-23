// POST /api/portal/receipts — recipient submits a receipt record after uploading the file.
//
// Security:
//   - image_path MUST be inside the caller's auth.uid() folder
//   - amount validated (Number.isFinite + upper cap)
//   - currency limited to CAD/USD
//   - submission_deadline enforced: rejected if past deadline
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

const MAX_RECEIPT_AMOUNT = 50_000;
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];
const ALLOWED_CURRENCIES = ["CAD", "USD"] as const;

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: recipient } = await supabase
    .from("recipients")
    .select("id, status, submission_deadline")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!recipient) return new NextResponse("no recipient linked to this account", { status: 400 });

  // Status guard
  if (recipient.status !== "active") {
    return new NextResponse("recipient account is not active", { status: 403 });
  }

  // Submission deadline guard
  if (recipient.submission_deadline) {
    const deadline = new Date(recipient.submission_deadline);
    deadline.setHours(23, 59, 59, 999);
    if (new Date() > deadline) {
      return new NextResponse(
        `Receipt submission window has closed (deadline was ${recipient.submission_deadline}). Please contact register@raisingarrowsathome.com if you believe this is an error.`,
        { status: 403 }
      );
    }
  }

  const body = await req.json().catch(() => ({} as any));
  const { image_path, amount, purchase_date, description, currency } = body;

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

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return new NextResponse("amount must be a positive number", { status: 400 });
  }
  if (numericAmount > MAX_RECEIPT_AMOUNT) {
    return new NextResponse(`amount exceeds maximum (${MAX_RECEIPT_AMOUNT})`, { status: 400 });
  }

  const cleanCurrency = ALLOWED_CURRENCIES.includes(currency) ? currency : "CAD";

  const { data, error } = await supabase
    .from("receipts")
    .insert({
      recipient_id:        recipient.id,
      image_path,
      amount:              numericAmount,
      currency:            cleanCurrency,
      reimbursable_amount: null,                  // admin sets at approval
      purchase_date:       purchase_date || null,
      description:         typeof description === "string" ? description.slice(0, 500) : null,
      status:              "pending",
    })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id });
}
