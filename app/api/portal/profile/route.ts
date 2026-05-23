// PATCH /api/portal/profile — recipient self-edit of phone + address.
// Server enforces: caller must own the recipient row (recipient.profile_id = auth.uid).
// Email + parent_names are intentionally NOT writable here.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

const CAD_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

export async function PATCH(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const recipientId    = typeof body?.recipientId === "string" ? body.recipientId : null;
  const applicationId  = typeof body?.applicationId === "string" ? body.applicationId : null;
  const contact_phone  = typeof body?.contact_phone  === "string" ? body.contact_phone.trim()  : "";
  const address_street = typeof body?.address_street === "string" ? body.address_street.trim() : "";
  const address_city   = typeof body?.address_city   === "string" ? body.address_city.trim()   : "";
  const address_postal = typeof body?.address_postal === "string" ? body.address_postal.trim().toUpperCase() : "";

  if (!recipientId || !applicationId) return NextResponse.json({ error: "recipientId + applicationId required" }, { status: 400 });
  if (contact_phone.length > 32)      return NextResponse.json({ error: "phone too long" }, { status: 400 });
  if (address_street.length > 120)    return NextResponse.json({ error: "street too long" }, { status: 400 });
  if (address_city.length > 64)       return NextResponse.json({ error: "city too long" }, { status: 400 });
  if (address_postal && !CAD_POSTAL.test(address_postal)) {
    return NextResponse.json({ error: "postal code must be Canadian format A1A 1A1" }, { status: 400 });
  }

  // Verify ownership: this recipient row must be tied to this user's profile.
  const svc = supabaseService();
  const { data: own } = await svc.from("recipients")
    .select("id, profile_id, application_id, address_street, address_city, address_postal")
    .eq("id", recipientId).maybeSingle();
  if (!own)                                 return NextResponse.json({ error: "not found" },     { status: 404 });
  if (own.profile_id !== user.id)           return NextResponse.json({ error: "forbidden" },    { status: 403 });
  if (own.application_id !== applicationId) return NextResponse.json({ error: "id mismatch" },  { status: 400 });

  const recipientBefore = { address_street: own.address_street, address_city: own.address_city, address_postal: own.address_postal };
  const recipientAfter  = { address_street, address_city, address_postal };

  // Update both rows. recipients (address) + applications (phone only).
  const { error: rErr } = await svc.from("recipients").update(recipientAfter).eq("id", recipientId);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const { data: appBefore } = await svc.from("applications").select("contact_phone").eq("id", applicationId).maybeSingle();
  const { error: aErr } = await svc.from("applications").update({ contact_phone }).eq("id", applicationId);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  await writeAudit({
    actorId: user.id,
    action: "self_edit_profile",
    targetTable: "recipients",
    targetId: recipientId,
    details: {
      recipient_diff:   { from: recipientBefore, to: recipientAfter },
      application_diff: { from: { contact_phone: appBefore?.contact_phone ?? null }, to: { contact_phone } },
    },
  });

  return NextResponse.json({ ok: true });
}
