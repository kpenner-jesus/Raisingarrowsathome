import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import ReceiptDecide from "./ReceiptDecide";
import ModifyForm from "./ModifyForm";

export const dynamic = "force-dynamic";

export default async function RecipientDetail({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const { data: recipient } = await supabase
    .from("recipients")
    .select("*, applications(parent_names, city, contact_email, contact_phone, children, app_ref)")
    .eq("id", params.id)
    .single();
  if (!recipient) return notFound();

  const [{ data: receipts }, { data: paidPayouts }, { data: testimonials }, { data: photos }] = await Promise.all([
    supabase.from("receipts").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("payouts").select("amount, paid_at, status").eq("recipient_id", recipient.id).eq("status", "paid"),
    supabase.from("testimonials").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("photos").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
  ]);

  const paidToDate = (paidPayouts || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const balance = calcBalance({
    receipts:  receipts || [],
    rate:      Number(recipient.reimbursement_rate),
    cap:       Number(recipient.approved_amount),
    paidToDate,
  });

  return (
    <div>
      <Link href="/admin/recipients" style={{ fontSize: "0.85rem", color: "#888" }}>← Recipients</Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", margin: "0.5rem 0 0.25rem" }}>
        {recipient.applications.parent_names}
      </h1>
      <div style={{ color: "#888", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        {recipient.applications.app_ref} · {recipient.applications.contact_email} · {recipient.applications.contact_phone}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Cap"                value={`$${Number(recipient.approved_amount).toFixed(2)}`} />
        <StatCard label="Approved receipts" value={`$${balance.approvedReceiptTotal.toFixed(2)}`} />
        <StatCard label="Paid to date"      value={`$${balance.paidToDate.toFixed(2)}`} />
        <StatCard label="Remaining"         value={`$${balance.remainingCap.toFixed(2)}`} />
        <StatCard label="Next payout"       value={`$${balance.eligibleForNextPayout.toFixed(2)}`} accent />
      </div>

      <ModifyForm recipient={{
        id: recipient.id,
        approved_amount: Number(recipient.approved_amount),
        reimbursement_rate: Number(recipient.reimbursement_rate),
        status: recipient.status,
      }} />

      <div style={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
        <div style={sectionTitle}>Receipts</div>
        {receipts && receipts.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Image</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r: any) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.purchase_date || new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={tdStyle}>${Number(r.amount).toFixed(2)}</td>
                  <td style={tdStyle}>{r.description || "—"}</td>
                  <td style={tdStyle}>{r.status}</td>
                  <td style={tdStyle}>
                    <a href={`/api/admin/receipt-image?path=${encodeURIComponent(r.image_path)}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>view</a>
                  </td>
                  <td style={tdStyle}>{r.status === "pending" && <ReceiptDecide id={r.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ fontSize: "0.9rem", color: "#888" }}>No receipts yet.</div>}
      </div>

      <div style={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
        <div style={sectionTitle}>Photos</div>
        {photos && photos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
            {photos.map((p: any) => (
              <a key={p.id} href={`/api/admin/photo-image?path=${encodeURIComponent(p.image_path)}`} target="_blank" rel="noreferrer" style={{ display: "block", borderRadius: 8, overflow: "hidden", border: "1px solid #eee" }}>
                <img src={`/api/admin/photo-image?path=${encodeURIComponent(p.image_path)}`} alt={p.caption || ""} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
                {p.caption && <div style={{ padding: "0.4rem 0.6rem", fontSize: "0.75rem", color: "#666", lineHeight: 1.4 }}>{p.caption}</div>}
              </a>
            ))}
          </div>
        ) : <div style={{ fontSize: "0.9rem", color: "#888" }}>None yet.</div>}
      </div>

      <div style={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 10, padding: "1.25rem 1.5rem" }}>
        <div style={sectionTitle}>Testimonials</div>
        {testimonials && testimonials.length > 0 ? testimonials.map((t: any) => (
          <div key={t.id} style={{ borderTop: "1px solid #f0f0f0", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <div style={{ fontSize: "0.72rem", color: "#888" }}>{new Date(t.created_at).toLocaleDateString()}</div>
            <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>{t.body}</div>
          </div>
        )) : <div style={{ fontSize: "0.9rem", color: "#888" }}>None yet.</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: "white", border: `1px solid ${accent ? "var(--accent)" : "#e5e5e5"}`, borderRadius: 10, padding: "1rem 1.25rem" }}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontFamily: "var(--font-display)", fontWeight: 500, color: accent ? "var(--accent)" : "inherit", marginTop: "0.25rem" }}>{value}</div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: "0.72rem", textTransform: "uppercase", color: "#888", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "1rem" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.55rem 0.75rem", borderBottom: "1px solid #eee", fontSize: "0.72rem", textTransform: "uppercase", color: "#888" };
const tdStyle: React.CSSProperties = { padding: "0.55rem 0.75rem", borderBottom: "1px solid #f5f5f5", fontSize: "0.875rem" };
