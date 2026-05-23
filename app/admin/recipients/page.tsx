import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import { AvatarRow } from "../_components/Avatar";
import { StatusBadge } from "../_components/StatusBadge";
import { ProgressBar } from "../_components/ProgressBar";

export const dynamic = "force-dynamic";

export default async function RecipientsList() {
  const supabase = supabaseServer();
  const { data: recipients } = await supabase
    .from("recipients")
    .select("id, approved_amount, reimbursement_rate, status, created_at, applications!inner(app_ref, parent_names, city, contact_email)")
    .order("created_at", { ascending: false });

  // Compute paid-to-date in one batched query
  let paidByRecipient: Record<string, number> = {};
  if (recipients && recipients.length > 0) {
    const { data: paid } = await supabase
      .from("payouts")
      .select("recipient_id, amount, status")
      .in("recipient_id", recipients.map((r: any) => r.id))
      .eq("status", "paid");
    (paid || []).forEach((p: any) => {
      paidByRecipient[p.recipient_id] = (paidByRecipient[p.recipient_id] || 0) + Number(p.amount);
    });
  }

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Funded families</span>
          <h1 className="ra-h1">Recipients</h1>
          <p className="ra-quiet">Approved families currently receiving reimbursements.</p>
        </div>
      </header>

      <div className="ra-table-card">
        <table className="ra-table">
          <thead>
            <tr>
              <th>Family</th>
              <th>Cap</th>
              <th style={{ minWidth: 220 }}>Progress</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Approved</th>
            </tr>
          </thead>
          <tbody>
            {(recipients || []).map((r: any) => {
              const paid = paidByRecipient[r.id] || 0;
              const cap = Number(r.approved_amount);
              const pct = cap > 0 ? paid / cap : 0;
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/recipients/${r.id}`}>
                      <AvatarRow name={r.applications.parent_names} secondary={`${r.applications.city} · ${r.applications.app_ref}`} />
                    </Link>
                  </td>
                  <td>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>
                      ${cap.toFixed(2)}
                    </span>
                    <div className="ra-tiny">{(Number(r.reimbursement_rate) * 100).toFixed(0)}% rate</div>
                  </td>
                  <td>
                    <ProgressBar value={pct} variant={pct >= 0.99 ? "success" : "default"} ariaLabel={`${Math.round(pct * 100)}% paid out`} />
                    <div className="ra-tiny" style={{ marginTop: "0.3rem" }}>
                      ${paid.toFixed(2)} paid · ${(cap - paid).toFixed(2)} remaining
                    </div>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td style={{ textAlign: "right" }} className="ra-tiny">
                    {new Date(r.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              );
            })}
            {(!recipients || recipients.length === 0) && (
              <tr>
                <td colSpan={5}>
                  <div className="ra-empty">
                    <div className="ra-empty-icon">❀</div>
                    <div className="ra-empty-title">No recipients yet</div>
                    <div>Approve an application to create one.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
