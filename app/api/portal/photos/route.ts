// POST /api/portal/photos — recipient submits a photo record after upload.
//
// Security: image_path MUST be inside the caller's own auth.uid() folder.
// Impersonation: when an admin is viewing as the test grantee, the photo
// is attached to the test recipient via service-role.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import { requireOrgContext } from "@/app/lib/org-context";
import { validatePortalUploadPath } from "@/app/lib/storage-path";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";

const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const orgCtx = await requireOrgContext();
  if (isTenantAccessBlocked(orgCtx.status)) return new NextResponse("portal is paused", { status: 423 });
  const ctx = await getEffectiveRecipient(user.id, orgCtx.id);
  const recipient = ctx.recipient;
  if (!recipient) return new NextResponse("no recipient", { status: 400 });

  const { image_path, caption } = await req.json().catch(() => ({} as any));
  // Requires the 3-segment layout <user_id>/<org_id>/<file>; the tenant segment
  // must equal the recipient's org_id. Legacy 2-segment paths are rejected.
  const pathCheck = validatePortalUploadPath(image_path, user.id, recipient.org_id);
  if (!pathCheck.ok) {
    return new NextResponse(pathCheck.error, { status: 400 });
  }
  const ext = (image_path as string).split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.includes(ext)) {
    return new NextResponse(`extension not allowed (must be one of ${ALLOWED_EXTS.join(", ")})`, { status: 400 });
  }

  const writeClient = ctx.mode === "impersonating" ? supabaseService() : supabase;
  // org_id is required (NOT NULL); take it off the recipient row so the photo
  // can never end up under the wrong tenant even if the caller's auth.uid
  // somehow belonged to a recipient in a different org.
  const { error } = await writeClient.from("photos").insert({
    org_id:       recipient.org_id,
    recipient_id: recipient.id,
    image_path,
    caption: typeof caption === "string" ? caption.slice(0, 300).trim() || null : null,
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
