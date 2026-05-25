import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { calcBalance } from "@/app/lib/grant-calc";
import { AvatarRow } from "../../_components/Avatar";
import { StatusBadge } from "../../_components/StatusBadge";
import { ProgressBar } from "../../_components/ProgressBar";
import ReceiptDecide from "./ReceiptDecide";
import ModifyForm from "./ModifyForm";
import { RecipientNotes } from "./RecipientNotes";
import { ArchiveControl } from "./ArchiveControl";
import { Timeline } from "./Timeline";
import { PrintButton } from "../../_components/PrintButton";

export const dynamic = "force-dynamic";

export default async function RecipientDetail({ params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();

  const { data: recipient } = await supabase
    .from("recipients")
    .select("*, applications(parent_names, city, contact_email, contact_phone, children, app_ref)")
    .eq("org_id", ctx.id)
    .eq("id", params.id)
    .single();
  if (!recipient) return notFound();

  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const svc = supabaseService();
  const { data: notesData } = await svc.from("recipient_notes")
    .select("id, author_id, body, created_at, profiles:author_id(email)")
    .eq("org_id", ctx.id)
    .eq("recipient_id", recipient.id)
    .order("created_at", { ascending: false });

  const [{ data: receipts }, { data: payouts }, { data: testimonials }, { data: photos }] = await Promise.all([
    supabase.from("receipts").select("*").eq("org_id", ctx.id).eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("payouts").select("*, payout_batches(scheduled_date, ceo_reference, status)").eq("org_id", ctx.id).eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("testimonials").select("*").eq("org_id", ctx.id).eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("photos").select("*").eq("org_id", ctx.id).eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
  ]);

  const paidToDate      = (payouts || []).filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const committedToDate = (payouts || []).filter((p: any) => p.status !== "cancelled").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const balance = calcBalance({
    receipts:        receipts || [],
    rate:            Number(recipient.reimbursement_rate),
    cap:             Number(recipient.approved_amount),
    paidToDate,
    committedToDate,
  });

  const cap = Number(recipient.approved_amount);
  const pendingCount = (receipts || []).filter((r: any) => r.status === "pending").length;

  return (
    <div>
      <Link href={orgPath(ctx, "/admin/recipients")} className="ra-breadcrumb">← All recipients</Link>

      <header className="ra-page-header" style={{ marginTop: "0.5rem" }}>
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">{recipient.applications.app_ref}</span>
          <div className="ra-row" style={{ alignItems: "center" }}>
            <AvatarRow
              name={recipient.applications.parent_names}
              secondary={`${recipient.applications.city} · ${recipient.applications.contact_email} · ${recipient.applications.contact_phone}`}
            />
            <StatusBadge status={recipient.status} />
          </div>
        </div>
        <PrintButton label="Print recipient" />
      </header>

      {/* Balance card with progress bar */}
      <section className="ra-card ra-card-accent" style={{ marginBottom: "1.5rem" }}>
        <div className="ra-row-between" style={{ marginBottom: "0.85rem" }}>
          <span className="ra-eyebrow">Grant balance</span>
          <span className="ra-tiny">{(Number(recipient.reimbursement_rate) * 100).toFixed(0)}% reimbursement</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", alignItems: "center" }}>
          <div>
            <div className="ra-quiet" style={{ fontSize: "0.85rem" }}>Paid of</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem", lineHeight: 1, color: "var(--ra-ink)" }}>
              ${paidToDate.toFixed(2)} <span className="ra-quiet" style={{ fontSize: "1rem" }}>/ ${cap.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: "0.6rem" }}>
              <ProgressBar value={cap > 0 ? paidToDate / cap : 0} variant={paidToDate >= cap ? "success" : "default"} ariaLabel="Grant payout progress" />
            </div>
          </div>
          <div className="ra-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
            <div className="ra-stat ra-card-tight">
              <span className="ra-stat-label">Approved receipts</span>
              <span className="ra-stat-value" style={{ fontSize: "1.4rem" }}>${balance.approvedReceiptTotal.toFixed(2)}</span>
            </div>
            <div className="ra-stat ra-card-tight">
              <span className="ra-stat-label">Remaining cap</span>
              <span className="ra-stat-value" style={{ fontSize: "1.4rem" }}>${balance.remainingCap.toFixed(2)}</span>
            </div>
            <div className="ra-stat ra-card-tight" style={{ gridColumn: "1 / -1", borderColor: "var(--ra-accent)" }}>
              <span className="ra-stat-label">Eligible next payout</span>
              <span className="ra-stat-value ra-stat-value" style={{ color: "var(--ra-accent)", fontSize: "1.6rem" }}>
                ${balance.eligibleForNextPayout.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Modify */}
      <ModifyForm recipient={{
        id: recipient.id,
        approved_amount: Number(recipient.approved_amount),
        reimbursement_rate: Number(recipient.reimbursement_rate),
        status: recipient.status,
        parent_names: recipient.applications.parent_names,
      }} />

      {/* Receipts */}
      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">
          Receipts
          {pendingCount > 0 && <span className="ra-badge ra-badge-pending">{pendingCount} pending</span>}
        </h3>
        {receipts && receipts.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {receipts.map((r: any) => (
              <li
                key={r.id}
                className="ra-receipt-row"
                style={{
                  background: r.status === "pending" ? "rgba(232,121,58,0.04)" : "var(--ra-bg-soft)",
                }}
              >
                <a href={`/api/admin/receipt-image?id=${r.id}`} target="_blank" rel="noreferrer"
                   style={{ display: "block", width: 60, height: 60, borderRadius: 8, overflow: "hidden", border: "1px solid var(--ra-line)", background: "#f3f0eb" }}>
                  <img src={`/api/admin/receipt-image?id=${r.id}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </a>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--ra-ink)" }}>{r.description || "Receipt"}</div>
                  <div className="ra-tiny">
                    {r.purchase_date || new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", color: "var(--ra-ink)" }}>
                    {r.currency || "CAD"} ${Number(r.amount).toFixed(2)}
                  </div>
                  {r.reimbursable_amount != null && (
                    <div className="ra-tiny" style={{ color: "var(--ra-accent)" }}>
                      → CAD ${Number(r.reimbursable_amount).toFixed(2)} reimbursable
                    </div>
                  )}
                </div>
                <StatusBadge status={r.status} />
                <div>
                  {r.status === "pending" && (
                    <ReceiptDecide
                      id={r.id}
                      amount={Number(r.amount)}
                      currency={(r.currency as any) || "CAD"}
                      rate={Number(recipient.reimbursement_rate)}
                      description={r.description}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ra-empty">
            <div className="ra-empty-icon">🧾</div>
            <div className="ra-empty-title">No receipts uploaded</div>
            <div>The recipient hasn't submitted any yet.</div>
          </div>
        )}
      </section>

      {/* Photos */}
      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">Photos</h3>
        {photos && photos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.6rem" }}>
            {photos.map((p: any) => (
              <a key={p.id} href={`/api/admin/photo-image?id=${p.id}`} target="_blank" rel="noreferrer"
                 style={{ display: "block", borderRadius: 10, overflow: "hidden", border: "1px solid var(--ra-line)" }}>
                <img src={`/api/admin/photo-image?id=${p.id}`} alt={p.caption || ""}
                     style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
                {p.caption && (
                  <div style={{ padding: "0.4rem 0.6rem", fontSize: "0.78rem", color: "var(--ra-ink-muted)", lineHeight: 1.4 }}>
                    {p.caption}
                  </div>
                )}
              </a>
            ))}
          </div>
        ) : <div className="ra-quiet">No photos yet.</div>}
      </section>

      {/* Payout history */}
      {payouts && payouts.length > 0 && (
        <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
          <h3 className="ra-section-title">Payout history</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {payouts.map((p: any) => (
              <li key={p.id} className="ra-row-between" style={{ fontSize: "0.9rem", padding: "0.5rem 0", borderTop: "1px solid var(--ra-line)" }}>
                <span>
                  <span className="ra-quiet">{p.payout_batches?.scheduled_date || "—"}</span>{" "}
                  {p.payout_batches?.ceo_reference && <span className="ra-tiny" style={{ marginLeft: "0.5rem" }}>{p.payout_batches.ceo_reference}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <StatusBadge status={p.status} />
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1rem" }}>${Number(p.amount).toFixed(2)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Testimonials */}
      <section className="ra-card">
        <h3 className="ra-section-title">Testimonials</h3>
        {testimonials && testimonials.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {testimonials.map((t: any) => (
              <blockquote key={t.id} style={{
                margin: 0, padding: "0.85rem 1rem",
                borderLeft: "3px solid var(--ra-accent)",
                background: "var(--ra-accent-soft)",
                borderRadius: "0 var(--ra-radius) var(--ra-radius) 0",
                fontSize: "0.92rem", lineHeight: 1.6, whiteSpace: "pre-wrap",
                color: "var(--ra-ink)",
              }}>
                <div className="ra-tiny" style={{ marginBottom: "0.25rem", color: "var(--ra-accent-dark)" }}>
                  {new Date(t.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                </div>
                {t.body}
              </blockquote>
            ))}
          </div>
        ) : <div className="ra-quiet">No testimonials yet.</div>}
      </section>

      {/* Timeline of receipts + payouts + notes + audit */}
      <Timeline recipientId={recipient.id} applicationId={recipient.application_id ?? null} />

      {/* Internal admin notes (cross-year context) */}
      <RecipientNotes
        recipientId={recipient.id}
        currentUserId={currentUser?.id ?? null}
        notes={(notesData ?? []).map((n: any) => ({
          id: n.id,
          author_id: n.author_id,
          author_email: n.profiles?.email ?? "(unknown)",
          body: n.body,
          created_at: n.created_at,
        }))}
      />

      {/* Archive / restore (data retention control) */}
      <ArchiveControl
        recipientId={recipient.id}
        archivedAt={recipient.archived_at ?? null}
        archiveReason={recipient.archive_reason ?? null}
      />
    </div>
  );
}
