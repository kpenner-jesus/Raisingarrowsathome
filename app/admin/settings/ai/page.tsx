// /admin/settings/ai — owner sets their own OpenRouter key + model so the
// tenant carries its own LLM cost. When unset, the assistant runs on the
// platform Anthropic model (Sonnet 4.6), which is also the auto-failover.

import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { secretsReady } from "@/app/lib/crypto";
import { AiSettingsForm } from "./AiSettingsForm";

export const dynamic = "force-dynamic";

export default async function AiSettings() {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const svc = supabaseService();
  const [{ data: tenant }, { data: secret }, { data: membership }] = await Promise.all([
    svc.from("tenants").select("ai_model").eq("id", ctx.id).maybeSingle(),
    svc.from("tenant_ai_secrets").select("org_id").eq("org_id", ctx.id).maybeSingle(),
    svc.from("org_members").select("role").eq("org_id", ctx.id).eq("user_id", user.id).maybeSingle(),
  ]);
  const isOwner = membership?.role === "owner";

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Assistant</span>
          <h1 className="ra-h1">AI assistant</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Run the in-app assistant on your own OpenRouter account + model. Leave it empty to use the
            platform default (Claude Sonnet 4.6) — which is also the automatic backup if your OpenRouter call fails.
          </p>
        </div>
      </header>

      {isOwner ? (
        <AiSettingsForm
          orgId={ctx.id}
          initialModel={tenant?.ai_model ?? ""}
          keyIsSet={!!secret}
          storageReady={secretsReady()}
        />
      ) : (
        <section className="ra-card">
          <p className="ra-quiet">Only the organization owner can change AI settings.</p>
        </section>
      )}

      <p className="ra-quiet" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
        <a href={orgPath(ctx, "/admin/settings")} style={{ color: "var(--text-muted)" }}>← back to settings</a>
      </p>
    </div>
  );
}
