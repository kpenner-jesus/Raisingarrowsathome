// POST /api/admin/invites  { email, role }
// Org owner/admin creates an invite to that org. Returns one-time link;
// also emails it to the invitee via Resend. Token shown only once.
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { Resend } from "resend";
import { getOrgContext } from "@/app/lib/org-context";
import { envTags, routeRecipients, routedSubject, routedNotice, stagingRedirectTarget } from "@/app/lib/email-env";

export async function POST(req: Request) {
  // Resolve tenant first — the invite is scoped to whichever org the
  // caller is currently administering (their host or /o/<slug> path).
  const orgCtx = await getOrgContext();
  if (!orgCtx) return NextResponse.json({ error: "no tenant resolved for this host" }, { status: 400 });

  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();

  // Caller must be an owner of this specific org (only owners can invite
  // other admins/owners; downgrades to plain admin still pass).
  const { data: membership } = await svc.from("org_members")
    .select("role").eq("org_id", orgCtx.id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  // Caller's profile email is used in the invite copy.
  const { data: profile } = await svc.from("profiles").select("email").eq("id", user.id).single();

  const body = await req.json().catch(() => ({} as any));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role  = body?.role === "owner" ? "owner" : "admin";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }

  // Mint token (32 bytes b64url)
  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: row, error } = await svc.from("admin_invites").insert({
    org_id: orgCtx.id,
    email, role, token_hash, expires_at,
    invited_by: user.id,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build the absolute invite URL from PLATFORM_URL + orgPath so the link
  // lands the invitee at THIS tenant's accept-invite page, not the host-default.
  // NOT under /admin: that layout bounces anyone without a membership, which
  // is precisely what an invitee lacks until this page runs.
  const platformOrigin = process.env.NEXT_PUBLIC_PLATFORM_URL || new URL(req.url).origin;
  const orgPathPrefix  = orgCtx.prefixed ? `/o/${orgCtx.slug}` : "";
  const inviteUrl = `${platformOrigin}${orgPathPrefix}/auth/accept-invite?token=${encodeURIComponent(token)}`;

  // Email the invite (best-effort). Use the tenant's verified sender when
  // available so the email comes from "<charity name> <register@charity.org>"
  // instead of the platform default.
  const RESEND_KEY = process.env.RESEND_API_KEY;
  let FROM = process.env.RESEND_FROM || "Raising Arrows Platform <onboarding@resend.dev>";
  const { data: tenantSender } = await svc.from("tenants")
    .select("name, sender_email, sender_verified")
    .eq("id", orgCtx.id).maybeSingle();
  if (tenantSender?.sender_verified && tenantSender.sender_email) {
    const safeName = String(tenantSender.name || "").replace(/[<>]/g, "").slice(0, 80);
    FROM = safeName ? `${safeName} <${tenantSender.sender_email}>` : tenantSender.sender_email;
  }

  if (RESEND_KEY) {
    try {
      const client = new Resend(RESEND_KEY);
      const routing = routeRecipients(email, { redirectTo: await stagingRedirectTarget() });
      if (!routing.send) {
        console.warn("[invites] not delivered:", routing.reason, { wouldHaveGoneTo: routing.wouldHaveGoneTo });
      } else {
        const subject = `You've been invited as a ${role.replace("_", " ")} on ${orgCtx.name}`;
        await client.emails.send({
          tags: envTags(),
          from: FROM, to: routing.to,
          subject: routedSubject(subject, routing),
          html: routedNotice(routing) + `<p>${(profile?.email || "An owner")} invited you to join ${orgCtx.name} as <strong>${role}</strong>.</p>
          <p style="margin:24px 0;"><a href="${inviteUrl}" style="background:#e8793a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;display:inline-block;">Accept invite</a></p>
          <p style="font-size:0.85rem;color:#666;">This link expires in 7 days. If you didn't expect this, ignore the email.</p>`,
        });
      }
    } catch (e) { /* log only — admin still has the URL in API response */ }
  }

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id, action: "create_admin_invite",
    targetTable: "admin_invites", targetId: row.id,
    details: { email, role, expires_at },
  });

  return NextResponse.json({ ok: true, invite_url: inviteUrl, expires_at });
}
