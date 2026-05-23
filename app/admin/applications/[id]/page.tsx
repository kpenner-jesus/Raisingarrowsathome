import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { defaultGrantCap } from "@/app/lib/grant-calc";
import { SITE_CONFIG } from "@/app/siteConfig";
import { AvatarRow } from "../../_components/Avatar";
import { StatusBadge } from "../../_components/StatusBadge";
import DecisionForm from "./DecisionForm";
import { ApplicationNotes } from "./ApplicationNotes";
import { PrintButton } from "../../_components/PrintButton";
import { ApplicationActivity } from "./ApplicationActivity";

export const dynamic = "force-dynamic";

export default async function ApplicationDetail({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const { data: app } = await supabase.from("applications").select("*").eq("id", params.id).single();
  if (!app) return notFound();

  const { data: recipient } = await supabase.from("recipients").select("*").eq("application_id", app.id).maybeSingle();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const svc = supabaseService();
  const { data: notesData } = await svc.from("application_notes")
    .select("id, author_id, body, created_at, profiles:author_id(email)")
    .eq("application_id", app.id)
    .order("created_at", { ascending: false });
  const defaultCap = defaultGrantCap(app.children || []);
  const kids = Array.isArray(app.children) ? app.children : [];

  const Field = ({ k, v, link }: { k: string; v: string | null; link?: boolean }) => (
    <div className="ra-kv">
      <span className="ra-kv-label">{k}</span>
      {link && v
        ? <a href={v} target="_blank" rel="noreferrer" className="ra-kv-link ra-kv-value">{v}</a>
        : <span className="ra-kv-value">{v || "—"}</span>}
    </div>
  );

  return (
    <div>
      <Link href="/admin/applications" className="ra-breadcrumb">← All applications</Link>

      <header className="ra-page-header" style={{ marginTop: "0.5rem" }}>
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">{app.app_ref}</span>
          <div className="ra-row" style={{ alignItems: "center" }}>
            <AvatarRow name={app.parent_names} secondary={`${app.city} · ${app.contact_email}`} />
            <StatusBadge status={app.status} />
          </div>
        </div>
        <PrintButton label="Print application" />
      </header>

      <div className="ra-detail-grid">
        {/* LEFT: Family + answers */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <section className="ra-card">
            <h3 className="ra-section-title">Family</h3>
            <div className="ra-kv-grid">
              <Field k="City"        v={app.city} />
              <Field k="Schooling"   v={app.current_schooling} />
              <Field k="Income"      v={app.income_range} />
              <Field k="Email"       v={app.contact_email} />
              <Field k="Phone"       v={app.contact_phone} />
              <Field k="Default cap" v={`$${defaultCap}`} />
            </div>
            <hr className="ra-divider" />
            <div>
              <div className="ra-kv-label" style={{ marginBottom: "0.5rem" }}>Children ({kids.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {kids.length > 0 ? kids.map((c: any, i: number) => (
                  <span key={i} className="ra-pill">
                    Age {c.age} · {c.grade}
                  </span>
                )) : <span className="ra-quiet">No children listed.</span>}
              </div>
            </div>
            {app.video_link && (
              <>
                <hr className="ra-divider" />
                <Field k="Video interview" v={app.video_link} link />
              </>
            )}
          </section>

          <section className="ra-card">
            <h3 className="ra-section-title">Written answers</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {SITE_CONFIG.questions.map((q, i) => {
                const answer = (app.answers?.[q.key] as string) || "";
                return (
                  <details key={q.key} open={i < 3} style={{ borderTop: i === 0 ? "0" : "1px solid var(--ra-line)", paddingTop: i === 0 ? "0" : "0.875rem" }}>
                    <summary style={{
                      cursor: "pointer", listStyle: "none",
                      fontSize: "0.88rem", fontWeight: 600, color: "var(--ra-ink-soft)",
                      display: "flex", justifyContent: "space-between", gap: "0.5rem",
                    }}>
                      <span>Q{i + 1}. {q.question}</span>
                      <span className="ra-tiny" style={{ flexShrink: 0 }}>
                        {answer ? `${answer.length} chars` : "—"}
                      </span>
                    </summary>
                    <div style={{
                      marginTop: "0.5rem", fontSize: "0.9rem",
                      whiteSpace: "pre-wrap", color: "var(--ra-ink)",
                      lineHeight: 1.6,
                    }}>
                      {answer || <span className="ra-quiet">No answer.</span>}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          {/* Activity timeline */}
          <ApplicationActivity applicationId={app.id} createdAt={app.created_at} />

          {/* Internal admin notes */}
          <ApplicationNotes
            applicationId={app.id}
            currentUserId={currentUser?.id ?? null}
            notes={(notesData ?? []).map((n: any) => ({
              id: n.id,
              author_id: n.author_id,
              author_email: n.profiles?.email ?? "(unknown)",
              body: n.body,
              created_at: n.created_at,
            }))}
          />
        </div>

        {/* RIGHT: Decision sidebar */}
        <div>
          <section className="ra-card ra-card-accent" style={{ position: "sticky", top: "1.5rem" }}>
            <h3 className="ra-section-title">Decision</h3>
            {recipient ? (
              <div>
                <div className="ra-alert ra-alert-success" style={{ marginBottom: "1rem" }}>
                  <span className="ra-badge-dot" />
                  <span>Approved · recipient active</span>
                </div>
                <div className="ra-kv-grid">
                  <div className="ra-kv">
                    <span className="ra-kv-label">Cap</span>
                    <span className="ra-kv-value" style={{ fontSize: "1.4rem", fontFamily: "var(--font-display)" }}>
                      ${Number(recipient.approved_amount).toFixed(2)}
                    </span>
                  </div>
                  <div className="ra-kv">
                    <span className="ra-kv-label">Rate</span>
                    <span className="ra-kv-value" style={{ fontSize: "1.4rem", fontFamily: "var(--font-display)" }}>
                      {(Number(recipient.reimbursement_rate) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <Link href={`/admin/recipients/${recipient.id}`} className="ra-btn ra-btn-accent" style={{ marginTop: "1.25rem", width: "100%" }}>
                  Open recipient →
                </Link>
              </div>
            ) : app.status === "denied" ? (
              <div>
                <div className="ra-alert ra-alert-error" style={{ marginBottom: "1rem" }}>
                  <span className="ra-badge-dot" />
                  <span>Denied</span>
                </div>
                {app.admin_notes && (
                  <div style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap", color: "var(--ra-ink-soft)" }}>
                    {app.admin_notes}
                  </div>
                )}
              </div>
            ) : (
              <DecisionForm
                applicationId={app.id}
                defaultCap={defaultCap}
                adminNotes={app.admin_notes || ""}
                parentNames={app.parent_names}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
