// POST /api/portal/receipts — recipient submits a receipt record after uploading the file.
//
// Security:
//   - image_path MUST be inside the caller's auth.uid() folder
//   - amount validated (Number.isFinite + upper cap)
//   - currency limited to CAD/USD
//   - submission_deadline enforced: rejected if past deadline
//   - When an admin is impersonating the test grantee (cookie set + env != prod),
//     the recipient_id is swapped to the test recipient via the helper and the
//     insert uses service-role so RLS doesn't block (admin isn't profile-linked).
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import { requireOrgContext } from "@/app/lib/org-context";
import { validatePortalUploadPath } from "@/app/lib/storage-path";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";

const MAX_RECEIPT_AMOUNT = 50_000;
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];
const ALLOWED_CURRENCIES = ["CAD", "USD"] as const;

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const orgCtx = await requireOrgContext();
  if (isTenantAccessBlocked(orgCtx.status, orgCtx.trial_ends_at)) return new NextResponse("portal is paused", { status: 423 });

  // Impersonation-aware recipient resolution.
  const ctx = await getEffectiveRecipient(user.id, orgCtx.id);
  const recipient = ctx.recipient;
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

  // Requires the 3-segment layout <user_id>/<org_id>/<file>; the tenant segment
  // must equal the resolved recipient's org — prevents a recipient who somehow
  // holds two memberships from cross-posting a receipt to a different tenant by
  // hand-crafting the path. Legacy 2-segment paths are rejected.
  const pathCheck = validatePortalUploadPath(image_path, user.id, recipient.org_id);
  if (!pathCheck.ok) {
    return new NextResponse(pathCheck.error, { status: 400 });
  }
  const ext = (image_path as string).split(".").pop()?.toLowerCase() ?? "";
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

  // Use service-role when impersonating so RLS doesn't reject the insert
  // (the admin isn't profile-linked to the test recipient). org_id is
  // taken off the recipient row — the source of truth for tenant binding.
  const writeClient = ctx.mode === "impersonating" ? supabaseService() : supabase;
  const { data, error } = await writeClient
    .from("receipts")
    .insert({
      org_id:              recipient.org_id,
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
