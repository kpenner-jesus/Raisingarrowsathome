// /portal/statement?year=YYYY — annual statement for a recipient.
// Family hits Print (Ctrl+P / browser menu) → Save as PDF. Print + desktop
// share the same table-style layout. Mobile gets a card timeline view.
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import { requireOrgContext } from "@/app/lib/org-context";
import { receiptReimbursable } from "@/app/lib/grant-calc";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

type TxnItem =
  | { kind: "receipt"; id: string; date: string; title: string; sub: string; amount: number; status: string }
  | { kind: "payout";  id: string; date: string; title: string; sub: string; amount: number; status: string };

export default async function StatementPage({ searchParams }: { searchParams?: { year?: string } }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=%2Fportal%2Fstatement");

  const orgCtx = await requireOrgContext();
  const svc = supabaseService();
  // Impersonation-aware lookup. Returns the test recipient when an admin
  // is viewing as a test grantee, else the user's own profile-linked row.
  const ctx = await getEffectiveRecipient(user.id, orgCtx.id);

  // Re-query with the wider projection (parent_names, app_ref, etc) this page needs.
  async function loadStatementRecipient(recipientId: string) {
    const { data } = await svc.from("recipients")
      .select(`
        id, approved_amount, reimbursement_rate, status, created_at, cohort_year,
        address_street, address_city, address_postal,
        applications!inner(parent_names, contact_email, contact_phone, city, app_ref)
      `)
      .eq("id", recipientId)
      .maybeSingle();
    return data;
  }

  const recipient = ctx.recipient ? await loadStatementRecipient(ctx.recipient.id) : null;

  if (!recipient) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 className="ra-h1">Statement</h1>
        <p className="ra-quiet">No recipient record found for your account.</p>
      </div>
    );
  }

  const now = new Date();
  const yearParam = searchParams?.year && /^\d{4}$/.test(searchParams.year) ? Number(searchParams.year) : now.getUTCFullYear();
  const start = `${yearParam}-01-01T00:00:00Z`;
  const end   = `${yearParam + 1}-01-01T00:00:00Z`;

  const [receiptsQ, payoutsQ] = await Promise.all([
    svc.from("receipts")
      .select("id, status, amount, currency, reimbursable_amount, description, purchase_date, created_at, decided_at")
      .eq("recipient_id", (recipient as any).id)
      .gte("created_at", start).lt("created_at", end)
      .order("purchase_date", { ascending: true, nullsFirst: false }),
    svc.from("payouts")
      .select("id, amount, currency, status, paid_at, created_at, payment_method, payment_reference")
      .eq("recipient_id", (recipient as any).id)
      .or(`paid_at.gte.${start},and(paid_at.is.null,created_at.gte.${start})`)
      .lt("created_at", end)
      .order("created_at", { ascending: true }),
  ]);

  const receipts: any[] = receiptsQ.data ?? [];
  const payouts:  any[] = payoutsQ.data ?? [];

  const approvedReceipts = receipts.filter((r) => r.status === "approved");
  const paidPayouts      = payouts.filter((p) => p.status === "paid");

  const totalReceiptsAmount      = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  // Use the shared calculation, not the override column: reimbursable_amount
  // is null unless an admin typed a figure, so reading it directly reported
  // $0.00 on the statement families are told to keep for their records.
  const rate = Number((recipient as any).reimbursement_rate);
  const totalReimbursableCAD     = approvedReceipts.reduce((s, r) => s + receiptReimbursable(r as any, rate), 0);
  const totalPaidCAD             = paidPayouts.reduce((s, p) => s + Number(p.amount || 0), 0);

  const yearOptions: number[] = [];
  for (let y = now.getUTCFullYear(); y >= 2024; y--) yearOptions.push(y);

  const app = (recipient as any).applications;

  // ── Combined month-grouped timeline for mobile view ──
  const items: TxnItem[] = [
    ...receipts.map((r): TxnItem => ({
      kind: "receipt",
      id: r.id,
      date: r.purchase_date || (r.created_at?.slice(0, 10) ?? ""),
      title: r.description || "Receipt",
      sub: `${r.currency || "CAD"} · ${r.status}`,
      amount: Number(r.amount || 0),
      status: r.status,
    })),
    ...paidPayouts.map((p): TxnItem => ({
      kind: "payout",
      id: p.id,
      date: p.paid_at?.slice(0, 10) ?? p.created_at?.slice(0, 10) ?? "",
      title: "Payout received",
      sub: `${p.payment_method || "e-transfer"}${p.payment_reference ? ` · ${p.payment_reference}` : ""}`,
      amount: Number(p.amount || 0),
      status: "paid",
    })),
  ];
  // Sort newest first for mobile (statement is typically read top-down)
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const byMonth = new Map<string, TxnItem[]>();
  for (const it of items) {
    const key = it.date.slice(0, 7); // YYYY-MM
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(it);
  }
  const monthLabels = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" });

  const totalReceiptsRemaining =
    Number((recipient as any).approved_amount) - totalPaidCAD;

  return (
    <div className="ra-statement">
      <style>{`
        /* Screen + print shared styles */
        .ra-statement { color: #1a1a1a; font-family: var(--font-body); max-width: 760px; margin: 0 auto; }
        .ra-stmt-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 1rem; border-bottom: 2px solid #1a1a1a; padding-bottom: 1rem; margin-bottom: 1.5rem; }
        .ra-stmt-brand { font-family: var(--font-display); font-style: italic; font-size: 1.6rem; color: #e8793a; line-height: 1; }
        .ra-stmt-section { margin-bottom: 1.75rem; }
        .ra-stmt-title { font-family: var(--font-display); font-size: 1.15rem; color: #1a1a1a; margin: 0 0 0.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; }
        .ra-stmt-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
        .ra-stmt-table th, .ra-stmt-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
        .ra-stmt-table th { font-weight: 600; background: rgba(0,0,0,0.03); }
        .ra-stmt-tot { font-weight: 600; }
        .ra-stmt-toolbar { display: flex; gap: 0.5rem; justify-content: flex-end; margin-bottom: 1rem; }
        @media print {
          .ra-stmt-toolbar, .ra-no-print { display: none !important; }
          .ra-statement { max-width: none; }
          body { background: white; }
          @page { margin: 0.5in; }
        }
      `}</style>

      <div className="ra-stmt-toolbar ra-no-print">
        <YearForm year={yearParam} yearOptions={yearOptions} />
        <PrintButton />
      </div>

      <div className="ra-stmt-head">
        <div>
          <div className="ra-stmt-brand">Raising Arrows</div>
          <div className="ra-tiny" style={{ marginTop: 4 }}>Homeschool grant statement · {yearParam}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
          <div><strong>{app.parent_names}</strong></div>
          {(recipient as any).address_street && <div>{(recipient as any).address_street}</div>}
          {((recipient as any).address_city || app.city) && (
            <div>{(recipient as any).address_city || app.city}{(recipient as any).address_postal ? ` ${(recipient as any).address_postal}` : ""}</div>
          )}
          <div>{app.contact_email}</div>
          <div className="ra-tiny" style={{ marginTop: 4 }}>Ref {app.app_ref}</div>
        </div>
      </div>

      {/* ════════════ MOBILE timeline view (CSS-toggled) ════════════ */}
      <div className="ra-stmt-mobile">
        <div className="ra-summary-strip">
          <div className="ra-summary-col">
            <div className="ra-summary-num">${totalReimbursableCAD.toFixed(0)}</div>
            <div className="ra-summary-lbl">Reimbursable</div>
          </div>
          <div className="ra-summary-col">
            <div className="ra-summary-num">${totalPaidCAD.toFixed(0)}</div>
            <div className="ra-summary-lbl">Paid out</div>
          </div>
          <div className="ra-summary-col">
            <div className="ra-summary-num">${Math.max(0, totalReceiptsRemaining).toFixed(0)}</div>
            <div className="ra-summary-lbl">Left</div>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="ra-quiet" style={{ textAlign: "center", padding: "2rem 0" }}>No activity in {yearParam}.</p>
        ) : (
          Array.from(byMonth.entries()).map(([month, list]: [string, TxnItem[]]) => {
            const monthLabel = month
              ? monthLabels.format(new Date(`${month}-01T00:00:00Z`))
              : "Undated";
            return (
              <div key={month || "undated"} className="ra-month-group">
                <div className="ra-month-label">{monthLabel}</div>
                <div className="ra-txn-rows">
                  {list.map((it: TxnItem) => {
                    const isIn = it.kind === "payout";
                    return (
                      <div key={`${it.kind}-${it.id}`} className="ra-txn-row">
                        <span className={`ra-txn-ic ${isIn ? "in" : "out"}`}>
                          {isIn ? "↓" : "📕"}
                        </span>
                        <span className="ra-txn-main">
                          <span className="ra-txn-title">{it.title}</span>
                          <span className="ra-txn-sub">{it.sub}</span>
                        </span>
                        <span className={`ra-txn-amt ${isIn ? "pos" : ""}`}>
                          {isIn ? "+" : ""}${it.amount.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ════════════ DESKTOP + PRINT table view (CSS-toggled) ════════════ */}
      <div className="ra-stmt-desktop">
      <section className="ra-stmt-section">
        <h2 className="ra-stmt-title">Grant summary</h2>
        <table className="ra-stmt-table">
          <tbody>
            <tr><td>Approved cap</td><td>${Number((recipient as any).approved_amount).toFixed(2)}</td></tr>
            <tr><td>Reimbursement rate</td><td>{(Number((recipient as any).reimbursement_rate) * 100).toFixed(0)}%</td></tr>
            <tr><td>Status</td><td style={{ textTransform: "capitalize" }}>{(recipient as any).status}</td></tr>
            <tr><td>Cohort year</td><td>{(recipient as any).cohort_year ?? "—"}</td></tr>
            <tr className="ra-stmt-tot"><td>Total receipts submitted in {yearParam}</td><td>${totalReceiptsAmount.toFixed(2)}</td></tr>
            <tr className="ra-stmt-tot"><td>Total reimbursable (CAD)</td><td>${totalReimbursableCAD.toFixed(2)}</td></tr>
            <tr className="ra-stmt-tot"><td>Total paid out in {yearParam}</td><td>${totalPaidCAD.toFixed(2)} CAD</td></tr>
          </tbody>
        </table>
      </section>

      <section className="ra-stmt-section">
        <h2 className="ra-stmt-title">Receipts ({receipts.length})</h2>
        {receipts.length === 0 ? (
          <p className="ra-quiet">No receipts submitted in {yearParam}.</p>
        ) : (
          <table className="ra-stmt-table">
            <thead><tr>
              <th>Date</th><th>Description</th><th>Amount</th><th>Currency</th><th>Status</th><th>Reimbursable (CAD)</th>
            </tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.purchase_date || (r.created_at?.slice(0, 10) ?? "")}</td>
                  <td>{r.description || "—"}</td>
                  <td>${Number(r.amount).toFixed(2)}</td>
                  <td>{r.currency || "CAD"}</td>
                  <td style={{ textTransform: "capitalize" }}>{r.status}</td>
                  <td>{r.reimbursable_amount != null ? `$${Number(r.reimbursable_amount).toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ra-stmt-section">
        <h2 className="ra-stmt-title">Payouts ({paidPayouts.length})</h2>
        {paidPayouts.length === 0 ? (
          <p className="ra-quiet">No payouts paid in {yearParam}.</p>
        ) : (
          <table className="ra-stmt-table">
            <thead><tr>
              <th>Date paid</th><th>Amount</th><th>Currency</th><th>Method</th><th>Reference</th>
            </tr></thead>
            <tbody>
              {paidPayouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.paid_at?.slice(0, 10) ?? "—"}</td>
                  <td>${Number(p.amount).toFixed(2)}</td>
                  <td>{p.currency || "CAD"}</td>
                  <td>{p.payment_method || "—"}</td>
                  <td>{p.payment_reference || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      </div>{/* /.ra-stmt-desktop */}

      <div className="ra-tiny" style={{ marginTop: "2rem", borderTop: "1px solid #eee", paddingTop: "1rem", color: "#666" }}>
        Generated {now.toLocaleString("en-CA")}. Disbursed by CEO Ministries, the registered Canadian charity that sponsors Raising Arrows. This statement is for your records — it is not a tax receipt. Questions: <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a>.
      </div>

      <div className="ra-no-print" style={{ marginTop: "2rem" }}>
        <Link href="/portal" style={{ color: "var(--text-muted)" }}>← Back to dashboard</Link>
      </div>
    </div>
  );
}

// Year selector renders a plain HTML form so we can keep the page a
// server component. Submit on change.
function YearForm({ year, yearOptions }: { year: number; yearOptions: number[] }) {
  return (
    <form method="get">
      <select name="year" defaultValue={String(year)} className="ra-input">
        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <noscript>
        <button type="submit" className="ra-btn" style={{ marginLeft: 6 }}>Go</button>
      </noscript>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.currentScript.previousElementSibling.previousElementSibling.addEventListener('change', function (e) { e.target.form && e.target.form.submit(); });`,
        }}
      />
    </form>
  );
}
