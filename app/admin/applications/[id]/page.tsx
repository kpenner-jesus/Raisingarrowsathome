import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { defaultGrantCap } from "@/app/lib/grant-calc";
import { SITE_CONFIG } from "@/app/siteConfig";
import DecisionForm from "./DecisionForm";

export const dynamic = "force-dynamic";

export default async function ApplicationDetail({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const { data: app } = await supabase.from("applications").select("*").eq("id", params.id).single();
  if (!app) return notFound();

  const { data: recipient } = await supabase.from("recipients").select("*").eq("application_id", app.id).maybeSingle();
  const defaultCap = defaultGrantCap(app.children || []);

  return (
    <div>
      <Link href="/admin/applications" style={{ fontSize: "0.85rem", color: "#888" }}>← Applications</Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", margin: "0.5rem 0 1.5rem" }}>
        {app.parent_names} <span style={{ color: "#888", fontSize: "1rem" }}>· {app.app_ref}</span>
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
        <div>
          <Section title="Family">
            <Field k="City"        v={app.city} />
            <Field k="Schooling"   v={app.current_schooling} />
            <Field k="Income"      v={app.income_range} />
            <Field k="Email"       v={app.contact_email} />
            <Field k="Phone"       v={app.contact_phone} />
            <Field k="Video"       v={app.video_link} link />
            <Field k="Children"    v={(app.children || []).map((c: any) => `Age ${c.age} · ${c.grade}`).join(" · ")} />
            <Field k="Default cap" v={`$${defaultCap}`} />
          </Section>

          <Section title="Written answers">
            {SITE_CONFIG.questions.map((q) => (
              <div key={q.key} style={{ marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#666" }}>{q.question}</div>
                <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>
                  {(app.answers?.[q.key] as string) || "—"}
                </div>
              </div>
            ))}
          </Section>
        </div>

        <div>
          <Section title="Decision">
            {recipient ? (
              <div>
                <div style={{ background: "#3a9e6e22", color: "#3a9e6e", padding: "0.6rem 0.9rem", borderRadius: 6, fontSize: "0.85rem", marginBottom: "0.75rem", fontWeight: 600 }}>
                  Approved · recipient created
                </div>
                <Field k="Cap"  v={`$${recipient.approved_amount}`} />
                <Field k="Rate" v={`${(Number(recipient.reimbursement_rate) * 100).toFixed(0)}%`} />
                <Link href={`/admin/recipients/${recipient.id}`} className="tf-ok" style={{ marginTop: "1rem", display: "inline-block", textDecoration: "none" }}>
                  View recipient
                </Link>
              </div>
            ) : app.status === "denied" ? (
              <div>
                <div style={{ background: "#e0505022", color: "#e05050", padding: "0.6rem 0.9rem", borderRadius: 6, fontSize: "0.85rem", fontWeight: 600 }}>
                  Denied
                </div>
                {app.admin_notes && <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{app.admin_notes}</div>}
              </div>
            ) : (
              <DecisionForm
                applicationId={app.id}
                defaultCap={defaultCap}
                adminNotes={app.admin_notes || ""}
              />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: "1rem" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", fontWeight: 700, marginBottom: "0.875rem" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ k, v, link }: { k: string; v: string | null; link?: boolean }) {
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", color: "#999", letterSpacing: "0.08em" }}>{k}</div>
      {link && v
        ? <a href={v} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all", fontSize: "0.9rem" }}>{v}</a>
        : <div style={{ fontSize: "0.9rem" }}>{v || "—"}</div>}
    </div>
  );
}
