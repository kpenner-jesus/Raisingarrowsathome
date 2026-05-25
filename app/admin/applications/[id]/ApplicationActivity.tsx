// Activity timeline for a single application — derived from audit_log.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";

const ACTION_LABELS: Record<string, string> = {
  decide_application: "Decision",
  add_note:           "Note added",
  delete_note:        "Note deleted",
  archive_record:     "Archived",
  restore_record:     "Restored",
};

export async function ApplicationActivity({ applicationId, createdAt }: {
  applicationId: string;
  createdAt: string;
}) {
  const ctx = await requireOrgContext();
  const svc = supabaseService();
  // Direct hits on the app itself + notes referencing it
  const { data: events } = await svc.from("audit_log").select(`
    id, action, target_table, target_id, details, created_at,
    profiles:actor_id(email)
  `)
    .eq("org_id", ctx.id)
    .or(`and(target_table.eq.applications,target_id.eq.${applicationId}),and(target_table.eq.application_notes,details->>application_id.eq.${applicationId})`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!events || events.length === 0) {
    return (
      <section className="ra-card">
        <h3 className="ra-section-title">Activity</h3>
        <div className="ra-quiet">Submitted {new Date(createdAt).toLocaleString()}. No admin actions yet.</div>
      </section>
    );
  }

  return (
    <section className="ra-card">
      <h3 className="ra-section-title">Activity</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {events.map((e: any) => (
          <li key={e.id} className="ra-row-between" style={{ fontSize: "0.86rem", padding: "0.3rem 0", borderBottom: "1px solid var(--ra-line)" }}>
            <span>
              <strong style={{ fontWeight: 500 }}>{ACTION_LABELS[e.action] ?? e.action}</strong>
              {e.details?.decision && <span className="ra-quiet"> · {e.details.decision}</span>}
              <span className="ra-quiet" style={{ fontSize: "0.78rem" }}> by {e.profiles?.email ?? "system"}</span>
            </span>
            <span className="ra-tiny" style={{ flexShrink: 0 }}>
              {new Date(e.created_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        ))}
        <li className="ra-row-between" style={{ fontSize: "0.86rem", padding: "0.3rem 0", color: "var(--ra-ink-muted)" }}>
          <span><strong style={{ fontWeight: 500 }}>Submitted by family</strong></span>
          <span className="ra-tiny">{new Date(createdAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </li>
      </ul>
    </section>
  );
}
