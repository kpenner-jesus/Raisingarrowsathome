// /admin/settings/branding — owner sets logo URL + accent colour for their org.
//
// MVP: URL input for logo (tenant hosts the image somewhere — their own site,
// Imgur, S3, anywhere). File upload to a "logos" Supabase bucket comes in a
// follow-up so we don't have to spin up bucket + RLS in this round.

import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { BrandingForm } from "./BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingSettings() {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const svc = supabaseService();
  const { data: tenant } = await svc.from("tenants")
    .select("id, name, logo_url, brand_color")
    .eq("id", ctx.id)
    .maybeSingle();

  const { data: membership } = await svc
    .from("org_members").select("role")
    .eq("org_id", ctx.id).eq("user_id", user.id).maybeSingle();
  const isOwner = membership?.role === "owner";

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Look + feel</span>
          <h1 className="ra-h1">Branding</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Your logo + accent colour appear on every page applicants + families see.
          </p>
        </div>
      </header>

      {isOwner ? (
        <BrandingForm
          orgId={ctx.id}
          initialLogoUrl={tenant?.logo_url ?? ""}
          initialBrandColor={tenant?.brand_color ?? "#e8793a"}
          orgName={tenant?.name ?? ctx.name}
        />
      ) : (
        <section className="ra-card">
          <p className="ra-quiet">Only the organization owner can change branding.</p>
        </section>
      )}

      <p className="ra-quiet" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
        <a href={orgPath(ctx, "/admin/settings")} style={{ color: "var(--text-muted)" }}>← back to settings</a>
      </p>
    </div>
  );
}
