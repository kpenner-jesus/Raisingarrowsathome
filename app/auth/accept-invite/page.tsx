// /auth/accept-invite?token=...
//
// MOVED OUT OF /admin/onboard. It used to live under app/admin/, so the admin
// layout ran first — and that layout redirects anyone without an org_members
// row away to the portal. Creating that very row is what this page does, so
// the invite email led nowhere for exactly the people it was meant for.
// Kept reachable at the old path via a redirect, for invites already in flight.
// Invitee clicks the link, sees a "Sign in with your invited email" prompt.
// On magic-link callback, we verify their auth.email matches the invite
// and promote them to the invited role. Server component renders the
// landing; actual promotion happens via POST after they're signed in.
import Link from "next/link";
import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

export default async function OnboardPage({ searchParams }: { searchParams?: { token?: string } }) {
  const ctx = await requireOrgContext();
  const token = searchParams?.token ?? "";
  if (!token) return shell("Missing token", "The invite link is incomplete.");

  const token_hash = createHash("sha256").update(token).digest("hex");
  const svc = supabaseService();
  const { data: invite } = await svc.from("admin_invites")
    .select("id, email, role, expires_at, used_at")
    .eq("org_id", ctx.id)
    .eq("token_hash", token_hash).maybeSingle();

  if (!invite)                                  return shell("Invite not found", "This invite link is invalid.");
  if (invite.used_at)                           return shell("Already used", "This invite has already been accepted.");
  if (new Date(invite.expires_at) < new Date()) return shell("Expired", "This invite expired. Ask the super_admin to send a fresh one.");

  // Check current session
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return shell(
      `Sign in as ${invite.email}`,
      `Use the magic-link form below to sign in with the exact email this invite was sent to. After signing in, come back to this page to accept.`,
      <Link href={`/auth/login?next=${encodeURIComponent(orgPath(ctx, `/auth/accept-invite?token=${token}`))}`}
        style={{ display: "inline-block", marginTop: "1rem", background: "var(--ra-accent)", color: "#fff", padding: "0.6rem 1.25rem", borderRadius: 100, textDecoration: "none", fontWeight: 500 }}>
        Sign in →
      </Link>
    );
  }

  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return shell("Wrong account",
      `You're signed in as ${user.email}, but this invite was sent to ${invite.email}. Sign out and sign back in with the invited address.`);
  }

  // Promote — but never DOWNGRADE. Profile.role is platform-level only
  // (super_admin etc.); tenant-admin status is recorded in org_members for
  // THIS tenant. Do the membership-granting writes FIRST and only mark the
  // invite used LAST — so any partial failure leaves the token re-usable
  // instead of stranding the invitee with a spent token + no membership.
  const { data: existing } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();

  // Ensure profile row exists (no role change unless they have no role yet).
  await svc.from("profiles").upsert(
    { id: user.id, email: user.email, role: existing?.role ?? "recipient" },
    { onConflict: "id", ignoreDuplicates: !!existing }
  );

  // Stamp the org membership so requireAdmin will accept them. Coerce
  // 'super_admin' (a platform role, not a tenant role) down to 'admin'.
  const tenantRole = invite.role === "owner" || invite.role === "admin" ? invite.role : "admin";
  const { error: memberErr } = await svc.from("org_members").upsert(
    { org_id: ctx.id, user_id: user.id, role: tenantRole },
    { onConflict: "org_id,user_id" }
  );
  if (memberErr) {
    // Membership failed → leave the invite UNused so they can retry.
    return shell("Couldn't complete setup", "Something went wrong granting your access. Open the invite link again to retry, or ask for a fresh invite.");
  }

  // Membership granted — now burn the token (last, so a failure above is retryable).
  await svc.from("admin_invites").update({ used_at: new Date().toISOString() }).eq("id", invite.id);

  redirect(orgPath(ctx, "/admin"));
}

function shell(title: string, body: string, action?: React.ReactNode) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", fontWeight: 500, marginBottom: "1rem" }}>{title}</h1>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "1rem" }}>{body}</p>
        {action}
        <div style={{ marginTop: "2rem" }}><Link href="/" style={{ color: "var(--text-muted)", textDecoration: "underline" }}>← Back to website</Link></div>
      </div>
    </div>
  );
}
