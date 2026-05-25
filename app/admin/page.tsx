import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { AvatarRow } from "./_components/Avatar";
import { StatusBadge } from "./_components/StatusBadge";
import { HelpHint } from "../_components/HelpHint";
import { ImpersonateButton } from "./_components/ImpersonateButton";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  decide_application:    "App decided",
  decide_receipt:        "Receipt decided",
  mark_paid:             "Payout marked paid",
  modify_recipient:      "Recipient modified",
  approve_testimonial:   "Testimonial approved",
  hide_testimonial:      "Testimonial hidden",
  feature_testimonial:   "Testimonial featured",
  update_settings:       "Settings updated",
  send_broadcast:        "Broadcast sent",
  add_note:              "Note added",
  delete_note:           "Note deleted",
  update_email_template: "Email template updated",
};

export default async function AdminDashboard() {
  const ctx = await requireOrgContext();
  const orgId = ctx.id;
  const supabase = supabaseServer();
  const svc = supabaseService();
  // Every query scoped to org_id. supabase (user role) is also RLS-scoped
  // via is_org_admin(org_id) policies; the explicit filter is defence-in-depth.
  const [pendingApps, activeRecipients, pendingReceipts, draftBatches, latestApps, latestReceipts, recentAudit, appsLast6Mo, anyAppsRes, customTemplatesCount] = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    supabase.from("recipients").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
    supabase.from("receipts").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    supabase.from("payout_batches").select("*", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["draft", "exported"]),
    supabase.from("applications").select("id, app_ref, parent_names, city, status, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(5),
    supabase.from("receipts").select("id, amount, status, created_at, description, recipients!inner(applications!inner(parent_names))").eq("org_id", orgId).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    svc.from("audit_log").select("id, action, target_table, created_at, profiles:actor_id(email)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(10),
    supabase.from("applications").select("created_at").eq("org_id", orgId).gte("created_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString()),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("email_templates").select("*", { count: "exact", head: true }).eq("org_id", orgId),
  ]);

  // Onboarding checklist — only render while at least one step incomplete.
  const checklist = [
    {
      label: "Add your logo + accent colour",
      done:  !!ctx.logo_url || (ctx.brand_color && ctx.brand_color.toLowerCase() !== "#e8793a"),
      href:  orgPath(ctx, "/admin/settings/branding"),
      hint:  "Replace the default Raising Arrows orange + add your logo.",
    },
    {
      label: "Verify your sending domain",
      done:  !!ctx.sender_verified,
      href:  orgPath(ctx, "/admin/settings/email-domain"),
      hint:  "Emails to families send from your own domain instead of the platform sender.",
    },
    {
      label: "Customize email templates",
      done:  (customTemplatesCount.count ?? 0) > 0,
      href:  orgPath(ctx, "/admin/email-templates"),
      hint:  "Edit the welcome / approve / deny / payout copy that families receive.",
    },
    {
      label: "Share your apply link with families",
      done:  (anyAppsRes.count ?? 0) > 0,
      href:  orgPath(ctx, "/apply/family"),
      hint:  `Public funnel URL: ${ctx.prefixed ? `/o/${ctx.slug}/apply/family` : "/apply/family"}`,
    },
  ];
  const onboardingComplete = checklist.every((c) => c.done);

  // Bucket apps by month over last 6 months
  const monthBuckets: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthBuckets.push({
      label: d.toLocaleString("en-CA", { month: "short" }),
      count: 0,
    });
  }
  for (const a of appsLast6Mo.data ?? []) {
    const d = new Date(a.created_at);
    const monthIdx = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
    const slot = 5 - monthIdx;
    if (slot >= 0 && slot < 6) monthBuckets[slot].count++;
  }
  const maxCount = Math.max(1, ...monthBuckets.map((b) => b.count));

  const stats: { label: string; value: number; href: string; pulse?: boolean; help: { body: string; examples?: string[] } }[] = [
    {
      label: "Pending applications", value: pendingApps.count ?? 0,
      href: "/admin/applications", pulse: (pendingApps.count ?? 0) > 0,
      help: { body: "Families who submitted the apply form and are waiting for your approve/deny decision.", examples: ["A new submission from 'Sarah and Tim Penner' came in last night and needs review."] },
    },
    {
      label: "Active recipients", value: activeRecipients.count ?? 0,
      href: "/admin/recipients",
      help: { body: "Approved families who are currently allowed to upload receipts. Suspended/completed recipients are not counted.", examples: ["7 grandfathered families + every new approval = the total here."] },
    },
    {
      label: "Receipts to review", value: pendingReceipts.count ?? 0,
      href: "/admin/recipients", pulse: (pendingReceipts.count ?? 0) > 0,
      help: { body: "Receipts a recipient has uploaded but you haven't approved/rejected yet. Approving sets the CAD reimbursable amount.", examples: ["A family uploaded a $124 Sonlight Core A invoice yesterday → 'pending' until you click ✓ or ×."] },
    },
    {
      label: "Open payout batches", value: draftBatches.count ?? 0,
      href: "/admin/payouts", pulse: (draftBatches.count ?? 0) > 0,
      help: { body: "Payout batches that haven't been marked paid yet. Includes both 'draft' (not yet exported) and 'exported' (CSV sent to CEO Ministries, awaiting their payment).", examples: ["After the 15th cron generates a batch, it sits as 'draft' until you download the CSV."] },
    },
  ];

  return (
    <div>
      <header className="ra-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Today</span>
          <h1 className="ra-h1">Welcome back</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Snapshot of what needs your attention.
          </p>
        </div>
        {/* Impersonation toggle — hidden on production via component-level guard */}
        <ImpersonateButton />
      </header>

      {!onboardingComplete && (
        <section className="ra-card" style={{
          marginBottom: "2rem",
          background: "linear-gradient(135deg, rgba(232,121,58,0.08), rgba(232,121,58,0.02))",
          border: "1.5px solid rgba(232,121,58,0.25)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
            <div>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ra-accent)", fontWeight: 600, marginBottom: "0.25rem" }}>
                Get started
              </div>
              <h3 className="ra-section-title" style={{ margin: 0, fontSize: "1.15rem" }}>
                Finish setting up your portal
              </h3>
            </div>
            <span className="ra-quiet" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
              {checklist.filter((c) => c.done).length} of {checklist.length} complete
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} style={{
                  display: "flex", alignItems: "center", gap: "0.85rem",
                  padding: "0.7rem 0.85rem",
                  background: c.done ? "rgba(58,158,110,0.06)" : "rgba(255,255,255,0.65)",
                  border: `1px solid ${c.done ? "rgba(58,158,110,0.2)" : "rgba(0,0,0,0.08)"}`,
                  borderRadius: 10,
                  textDecoration: "none", color: "inherit",
                  transition: "background 0.12s",
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    display: "grid", placeItems: "center", flexShrink: 0,
                    background: c.done ? "#3a9e6e" : "rgba(0,0,0,0.06)",
                    color: c.done ? "#fff" : "var(--text-muted)",
                    fontSize: "0.78rem", fontWeight: 700,
                  }}>{c.done ? "✓" : ""}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", textDecoration: c.done ? "line-through" : "none", opacity: c.done ? 0.6 : 1 }}>
                      {c.label}
                    </div>
                    <div className="ra-quiet" style={{ fontSize: "0.82rem", marginTop: "0.15rem" }}>
                      {c.hint}
                    </div>
                  </span>
                  {!c.done && <span style={{ color: "var(--ra-accent)", flexShrink: 0 }}>→</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ra-stat-grid" style={{ marginBottom: "2.25rem" }}>
        {stats.map((s) => (
          <div key={s.label} className={`ra-stat ${s.pulse ? "ra-stat-pulse" : ""} ${s.value > 0 && s.pulse ? "ra-stat-accent" : ""}`} style={{ position: "relative" }}>
            <span className="ra-stat-label" style={{ display: "flex", alignItems: "center" }}>
              {s.label}
              <HelpHint body={s.help.body} examples={s.help.examples} />
            </span>
            <Link href={s.href} style={{ color: "inherit", textDecoration: "none" }}>
              <span className="ra-stat-value">{s.value}</span>
              <span className="ra-stat-sub" style={{ display: "block", marginTop: 4 }}>
                {s.value === 0 ? "All clear" : "View →"}
              </span>
            </Link>
          </div>
        ))}
      </div>

      {/* AI / MCP banner */}
      <section className="ra-card" style={{
        marginBottom: "2rem",
        background: "linear-gradient(135deg, #1e1715 0%, #2a201d 100%)",
        color: "#fff", border: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.55)", fontWeight: 600, marginBottom: "0.25rem" }}>
            New
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 500 }}>
            Drive this portal with Claude (or any AI)
          </div>
          <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.75)", marginTop: "0.35rem", maxWidth: 520, lineHeight: 1.55 }}>
            This site exposes an MCP server with 17 admin tools. Connect Claude Code or Claude Desktop and run the grant program by chatting.
          </div>
        </div>
        <Link href="/admin/mcp" className="ra-btn ra-btn-accent" style={{ flexShrink: 0 }}>
          Connect AI →
        </Link>
      </section>

      {/* Activity + apps-per-month chart */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem", marginBottom: "1.25rem" }}>
        <section className="ra-card">
          <h3 className="ra-section-title">
            Applications (last 6 months)
            <Link href="/admin/reports" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>Full reports</Link>
          </h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", height: 140, padding: "0.5rem 0" }}>
            {monthBuckets.map((b) => (
              <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
                <div title={`${b.count} apps`} style={{
                  width: "100%", maxWidth: 36,
                  height: `${(b.count / maxCount) * 100}%`,
                  minHeight: 2,
                  background: "linear-gradient(180deg, var(--ra-accent), #f0a070)",
                  borderRadius: "6px 6px 2px 2px",
                  transition: "background 0.18s",
                }} />
                <div className="ra-tiny" style={{ fontVariantNumeric: "tabular-nums" }}>{b.count}</div>
                <div className="ra-tiny" style={{ color: "var(--ra-ink-quiet)" }}>{b.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="ra-card">
          <h3 className="ra-section-title">
            Recent activity
            <Link href="/admin/audit-log" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>Full log</Link>
          </h3>
          {(recentAudit.data?.length ?? 0) === 0 ? (
            <div className="ra-quiet">No admin activity logged yet.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {(recentAudit.data as any[]).map((e) => (
                <li key={e.id} className="ra-row-between" style={{ fontSize: "0.85rem" }}>
                  <span>
                    <strong style={{ fontWeight: 500 }}>{ACTION_LABELS[e.action] ?? e.action}</strong>{" "}
                    <span className="ra-quiet" style={{ fontSize: "0.78rem" }}>by {e.profiles?.email ?? "system"}</span>
                  </span>
                  <span className="ra-tiny" style={{ flexShrink: 0 }}>
                    {new Date(e.created_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
        {/* Latest applications */}
        <section className="ra-card">
          <h3 className="ra-section-title">
            Latest applications
            <Link href="/admin/applications" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              View all
            </Link>
          </h3>
          {latestApps.data && latestApps.data.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {latestApps.data.map((a: any) => (
                <li key={a.id}>
                  <Link href={`/admin/applications/${a.id}`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
                    padding: "0.6rem 0.75rem", margin: "0 -0.75rem",
                    borderRadius: 8, textDecoration: "none", color: "inherit",
                    transition: "background 0.12s",
                  }}>
                    <AvatarRow name={a.parent_names} secondary={`${a.city} · ${a.app_ref}`} />
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ra-empty">
              <div className="ra-empty-icon">✉</div>
              <div className="ra-empty-title">No applications yet</div>
              <div>They'll show up here as families submit.</div>
            </div>
          )}
        </section>

        {/* Pending receipts */}
        <section className="ra-card">
          <h3 className="ra-section-title">
            Receipts awaiting review
            <Link href="/admin/recipients" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              Go to recipients
            </Link>
          </h3>
          {latestReceipts.data && latestReceipts.data.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {latestReceipts.data.map((r: any) => (
                <li key={r.id} className="ra-row-between" style={{ fontSize: "0.9rem", padding: "0.35rem 0" }}>
                  <span>
                    <strong style={{ fontWeight: 500 }}>{r.recipients.applications.parent_names}</strong>{" "}
                    <span className="ra-quiet" style={{ fontSize: "0.85rem" }}>{r.description || "Receipt"}</span>
                  </span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1rem", color: "var(--ra-accent)" }}>
                    ${Number(r.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ra-empty">
              <div className="ra-empty-icon">✓</div>
              <div className="ra-empty-title">Nothing waiting</div>
              <div>All receipts reviewed.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
