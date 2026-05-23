// POST /api/admin/invites  { email, role }
// Super_admin creates an invite. Returns one-time link; also emails it
// to the invitee via Resend. Token shown only once.
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { Resend } from "resend";

export async function POST(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role, email").eq("id", user.id).single();
  if (profile?.role !== "super_admin") {
    return NextResponse.json({ error: "super_admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role  = body?.role === "super_admin" ? "super_admin" : "admin";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }

  // Mint token (32 bytes b64url)
  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: row, error } = await svc.from("admin_invites").insert({
    email, role, token_hash, expires_at,
    invited_by: user.id,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = new URL(req.url).origin;
  const inviteUrl = `${origin}/admin/onboard?token=${encodeURIComponent(token)}`;

  // Email the invite (best-effort)
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
  if (RESEND_KEY) {
    try {
      const client = new Resend(RESEND_KEY);
      await client.emails.send({
        from: FROM, to: email,
        subject: `You've been invited as a ${role.replace("_", " ")} on Raising Arrows`,
        html: `<p>${(profile?.email || "A super-admin")} invited you to join Raising Arrows as <strong>${role}</strong>.</p>
          <p style="margin:24px 0;"><a href="${inviteUrl}" style="background:#e8793a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;display:inline-block;">Accept invite</a></p>
          <p style="font-size:0.85rem;color:#666;">This link expires in 7 days. If you didn't expect this, ignore the email.</p>`,
      });
    } catch (e) { /* log only — admin still has the URL in API response */ }
  }

  await writeAudit({
    actorId: user.id, action: "create_admin_invite",
    targetTable: "admin_invites", targetId: row.id,
    details: { email, role, expires_at },
  });

  return NextResponse.json({ ok: true, invite_url: inviteUrl, expires_at });
}
