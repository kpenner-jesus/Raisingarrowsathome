// /admin/settings/email-domain
//
// Org owners verify their own sending domain (DKIM/SPF/DMARC via Resend).
// Tenants that haven't verified send through the shared platform sender
// (noreply@raisingarrowsathome.com). Each tenant having their OWN sender
// isolates deliverability — one spammy tenant won't drag the others down.
//
// Flow:
//   1. Owner enters their sending domain (e.g. yourchurch.org).
//   2. POST /api/admin/email-domain/create → calls Resend.
//   3. We store the resend domain id + show the DNS records the user
//      must add at their registrar.
//   4. Owner adds records. Clicks "Check status".
//   5. POST /api/admin/email-domain/verify → Resend reports back; if
//      verified, we flip tenants.sender_verified = true and switch
//      sending to use sender_email going forward.

import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { DomainPanel } from "./DomainPanel";

export const dynamic = "force-dynamic";

export default async function EmailDomainSettings() {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const svc = supabaseService();

  // Read tenant's current domain state.
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, name, sender_email, sender_domain, sender_resend_domain_id, sender_verified")
    .eq("id", ctx.id)
    .maybeSingle();

  // Membership / role
  const { data: membership } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", ctx.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Outbound email</span>
          <h1 className="ra-h1">Sending domain</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem", maxWidth: 640 }}>
            Verify <strong>your own domain</strong> so magic-link emails, payout notifications,
            and broadcasts come from <code>notifications@yourchurch.org</code> instead of a shared
            platform address. Verified domains land in inboxes — unverified shared senders end up
            in spam over time.
          </p>
        </div>
      </header>

      {!isOwner ? (
        <section className="ra-card">
          <p className="ra-quiet">Only the organization owner can set up your sending domain.</p>
        </section>
      ) : (
        <DomainPanel
          orgId={ctx.id}
          currentDomain={tenant?.sender_domain ?? null}
          currentSenderEmail={tenant?.sender_email ?? null}
          resendDomainId={tenant?.sender_resend_domain_id ?? null}
          verified={tenant?.sender_verified ?? false}
        />
      )}

      <p className="ra-quiet" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
        <a href={orgPath(ctx, "/admin/settings")} style={{ color: "var(--text-muted)" }}>← back to settings</a>
      </p>
    </div>
  );
}
