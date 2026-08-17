// /admin/data — "Download your data".
//
// Every export the tenant can take, in one place, per year, with row counts so
// nobody has to guess whether a file will be empty.
//
// This page replaces a monthly cron that emailed a JSON dump of EVERY tenant's
// tables to the platform's super-admins. That crossed charity boundaries, put
// families' addresses and income ranges permanently into inboxes and mail-
// provider logs, and served nobody who actually wanted their own data.
//
// It works while a subscription is paused or canceled — see
// requireAdminForDataExport. The moment a charity most needs a copy of its
// records is when it is deciding whether to leave.
//
// NOTE: a CSV download is NOT a backup. Backups exist to restore a system;
// these files lose relationships and nothing reads them back. Disaster
// recovery is Supabase's automatic backups.

import Link from "next/link";
import { getOrgContext, orgPath } from "@/app/lib/org-context";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  kind:        string;
  title:       string;
  description: string;
  byYear:      boolean;
  count?:      number | null;
};

export default async function DataHub({
  searchParams,
}: {
  searchParams?: { year?: string };
}) {
  const ctx = await getOrgContext();
  const op  = (p: string) => orgPath(ctx, p);

  const thisYear = new Date().getUTCFullYear();
  const yearRaw  = searchParams?.year;
  const year     = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : thisYear;

  const years: number[] = [];
  for (let y = thisYear; y >= 2024; y--) years.push(y);

  const start = `${year}-01-01T00:00:00Z`;
  const end   = `${year + 1}-01-01T00:00:00Z`;

  // Counts so "will this file be empty?" is visible rather than a surprise.
  // head:true means we fetch no rows at all — just the number.
  const svc = supabaseService();
  const orgId = ctx?.id ?? "";
  const countIn = (table: string, col = "created_at") =>
    svc.from(table).select("id", { count: "exact", head: true })
      .eq("org_id", orgId).gte(col, start).lt(col, end);

  const [applications, receipts, payouts, recipients, auditLog, photos] = await Promise.all([
    countIn("applications"),
    countIn("receipts"),
    countIn("payouts"),
    svc.from("recipients").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    countIn("audit_log"),
    countIn("photos"),
  ]);

  const rows: Row[] = [
    {
      kind: "applications", byYear: true, count: applications.count,
      title: "Applications",
      description: "Every application submitted, with each family's written answers and their children's ages and grades.",
    },
    {
      kind: "recipients", byYear: false, count: recipients.count,
      title: "Approved families",
      description: "Approved families with contact details, mailing address, funding cap and reimbursement rate. Not filtered by year.",
    },
    {
      kind: "receipts", byYear: true, count: receipts.count,
      title: "Receipts",
      description: "Every receipt submitted, with amount, category, purchase date and decision.",
    },
    {
      kind: "payouts", byYear: true, count: payouts.count,
      title: "Payouts",
      description: "Every payout with method, reference and the date it was paid.",
    },
    {
      kind: "transactions", byYear: true, count: null,
      title: "Transactions ledger",
      description: "Approved receipts and paid payouts combined into one dated ledger. This is the CRA-ready one.",
    },
    {
      kind: "audit_log", byYear: true, count: auditLog.count,
      title: "Audit log",
      description: "Who changed what, and when. Capped at the most recent 5,000 entries.",
    },
  ];

  const href = (r: Row) =>
    `/api/admin/exports/${r.kind}${r.byYear ? `?year=${year}` : ""}`;

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Your records</span>
          <h1 className="ra-h1">Download your data</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Everything you have entered, as spreadsheet files you can open in Excel or Google Sheets.
          </p>
        </div>
      </header>

      {/* Year picker — plain links, so this page needs no client JS. */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.25rem" }}>
        <span className="ra-quiet" style={{ fontSize: "0.8rem", marginRight: "0.25rem" }}>Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`${op("/admin/data")}?year=${y}`}
            className={y === year ? "ra-btn ra-btn-primary" : "ra-btn"}
            style={{ padding: "0.3rem 0.7rem", fontSize: "0.82rem" }}
          >
            {y}
          </Link>
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: "1rem",
      }}>
        {rows.map((r) => {
          const empty = r.count === 0;
          return (
            <div key={r.kind} style={{
              background: "rgba(255,255,255,0.85)",
              border: "1.5px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              padding: "1.15rem 1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {r.title}
                  {typeof r.count === "number" && (
                    <span className="ra-quiet" style={{ fontWeight: 400, fontSize: "0.82rem", marginLeft: "0.5rem" }}>
                      {r.count.toLocaleString()} {r.count === 1 ? "row" : "rows"}
                    </span>
                  )}
                </div>
                <div className="ra-quiet" style={{ fontSize: "0.84rem", lineHeight: 1.55 }}>
                  {r.description}
                </div>
              </div>
              <div style={{ marginTop: "auto" }}>
                {empty ? (
                  <span className="ra-quiet" style={{ fontSize: "0.82rem" }}>
                    Nothing to download for {year}.
                  </span>
                ) : (
                  // A plain anchor, not a fetch: the server sets
                  // Content-Disposition, so the browser saves the file with no
                  // client JS involved.
                  <a href={href(r)} className="ra-btn">
                    ⬇ Download {r.byYear ? year : "CSV"}
                  </a>
                )}
              </div>
            </div>
          );
        })}

        {/* Photos are binaries, so they get a zip rather than a CSV, and the
            route pages itself to stay under the platform's response cap. */}
        <div style={{
          background: "rgba(255,255,255,0.85)",
          border: "1.5px solid rgba(0,0,0,0.08)",
          borderRadius: 14,
          padding: "1.15rem 1.25rem",
          display: "flex", flexDirection: "column", gap: "0.6rem",
        }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
              Photos
              {typeof photos.count === "number" && (
                <span className="ra-quiet" style={{ fontWeight: 400, fontSize: "0.82rem", marginLeft: "0.5rem" }}>
                  {photos.count.toLocaleString()} {photos.count === 1 ? "photo" : "photos"}
                </span>
              )}
            </div>
            <div className="ra-quiet" style={{ fontSize: "0.84rem", lineHeight: 1.55 }}>
              A zip of the photos families uploaded, plus a spreadsheet listing who sent each one.
              Large years download in batches.
            </div>
          </div>
          <div style={{ marginTop: "auto" }}>
            {photos.count === 0 ? (
              <span className="ra-quiet" style={{ fontSize: "0.82rem" }}>Nothing to download for {year}.</span>
            ) : (
              <a href={`/api/admin/exports/photos.zip?year=${year}`} className="ra-btn">⬇ Download zip</a>
            )}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: "1.75rem",
        background: "rgba(255,255,255,0.6)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        padding: "1rem 1.25rem",
        fontSize: "0.82rem",
        lineHeight: 1.7,
      }}>
        <p style={{ margin: "0 0 0.6rem" }}>
          <strong>These files are a copy, not a backup.</strong> They are for your accountant,
          your board, or taking your records with you. They cannot be loaded back in to rebuild
          the system — restoring from disaster is handled separately, by the database's own
          automatic backups.
        </p>
        <p style={{ margin: 0 }} className="ra-quiet">
          Downloads keep working if your subscription is paused or after you cancel, for as long
          as we hold your data. Every file contains only your organisation&apos;s records.
        </p>
      </div>
    </div>
  );
}
