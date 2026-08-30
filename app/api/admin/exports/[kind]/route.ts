// GET /api/admin/exports/[kind]?year=YYYY
//   kind: 'receipts' | 'payouts' | 'recipients' | 'transactions'
//       | 'audit_log' | 'applications'
// Returns a text/csv attachment scoped to the caller's own tenant.
//
// Admin only, but NOT blocked for a paused or canceled tenant — see
// requireAdminForDataExport.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdminForDataExport, AdminAuthError } from "@/app/lib/admin/require-admin";
import { toCsv, csvBody, csvHeaders, exportFilename } from "@/app/lib/csv";
import { SITE_CONFIG } from "@/app/siteConfig";
import {
  childrenSummary, childrenCount, answerColumns, answerValue,
} from "@/app/lib/exports/application-columns";

const VALID_KINDS = new Set([
  "receipts", "payouts", "recipients", "transactions", "audit_log", "applications",
]);

export async function GET(req: Request, ctx: { params: { kind: string } }) {
  const kind = ctx.params.kind;
  if (!VALID_KINDS.has(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  // Deliberately the relaxed gate: a paused or canceled tenant must still be
  // able to take a copy of its own records. Identity checks are unchanged.
  let auth;
  try { auth = await requireAdminForDataExport(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { ctx: orgCtx } = auth;
  const svc = supabaseService();

  const url = new URL(req.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  const startISO = year ? `${year}-01-01T00:00:00Z` : null;
  const endISO   = year ? `${year + 1}-01-01T00:00:00Z` : null;

  let csv = "";
  let filename = "";

  if (kind === "receipts") {
    let q = svc.from("receipts").select(`
      id, status, amount, currency, reimbursable_amount, description, category,
      purchase_date, created_at, recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("org_id", orgCtx.id).order("created_at", { ascending: false });
    if (startISO) q = q.gte("created_at", startISO).lt("created_at", endISO);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    csv = toCsv(
      ["Date", "App ref", "Family", "Description", "Category", "Amount", "Currency", "Reimbursable (CAD)", "Status"],
      (data ?? []).map((r: any) => [
        r.purchase_date || (r.created_at?.slice(0, 10) ?? ""),
        r.recipients?.applications?.app_ref ?? "",
        r.recipients?.applications?.parent_names ?? "",
        r.description ?? "",
        r.category ?? "",
        r.amount ?? 0,
        r.currency ?? "CAD",
        r.reimbursable_amount ?? "",
        r.status ?? "",
      ])
    );
    filename = exportFilename(orgCtx.slug, "receipts", year);

  } else if (kind === "payouts") {
    // select * rather than a named list: payouts has NO `currency` column in
    // either environment, and naming it made this export return 500 every time
    // it was ever clicked. Migrations here are hand-applied, so an export must
    // not break the moment the schema and the code disagree.
    let q = svc.from("payouts").select(`
      *, recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("org_id", orgCtx.id).order("created_at", { ascending: false });
    if (startISO) q = q.gte("created_at", startISO).lt("created_at", endISO);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    csv = toCsv(
      ["Date created", "Date paid", "App ref", "Family", "Amount", "Currency", "Method", "Reference", "Status"],
      (data ?? []).map((p: any) => [
        p.created_at?.slice(0, 10) ?? "",
        p.paid_at?.slice(0, 10) ?? "",
        p.recipients?.applications?.app_ref ?? "",
        p.recipients?.applications?.parent_names ?? "",
        p.amount ?? 0,
        (p as any).currency ?? "CAD",
        p.payment_method ?? "",
        p.payment_reference ?? "",
        p.status ?? "",
      ])
    );
    filename = exportFilename(orgCtx.slug, "payouts", year);

  } else if (kind === "recipients") {
    const { data, error } = await svc.from("recipients").select(`
      id, status, reimbursement_rate, approved_amount, created_at, cohort_year,
      address_street, address_city, address_postal,
      applications!inner(parent_names, app_ref, contact_email, contact_phone, city)
    `).eq("org_id", orgCtx.id).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    csv = toCsv(
      ["App ref", "Family", "Email", "Phone", "Address street", "Address city", "Postal", "Status", "Rate", "Cap (approved)", "Cohort year", "Approved date"],
      (data ?? []).map((r: any) => [
        r.applications?.app_ref ?? "",
        r.applications?.parent_names ?? "",
        r.applications?.contact_email ?? "",
        r.applications?.contact_phone ?? "",
        r.address_street ?? "",
        r.address_city ?? r.applications?.city ?? "",
        r.address_postal ?? "",
        r.status ?? "",
        r.reimbursement_rate ?? "",
        r.approved_amount ?? "",
        r.cohort_year ?? "",
        r.created_at?.slice(0, 10) ?? "",
      ])
    );
    filename = exportFilename(orgCtx.slug, "recipients");

  } else if (kind === "audit_log") {
    let q = svc.from("audit_log").select(`
      created_at, action, target_table, target_id, details,
      profiles:actor_id(email)
    `).eq("org_id", orgCtx.id).order("created_at", { ascending: false }).limit(5000);
    if (startISO) q = q.gte("created_at", startISO).lt("created_at", endISO);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    csv = toCsv(
      ["When", "Actor", "Action", "Target table", "Target id", "Details (JSON)"],
      (data ?? []).map((r: any) => [
        r.created_at,
        r.profiles?.email ?? "",
        r.action,
        r.target_table,
        r.target_id,
        JSON.stringify(r.details ?? {}),
      ])
    );
    filename = exportFilename(orgCtx.slug, "audit-log", year);

  } else if (kind === "transactions") {
    // Combined approved receipts + paid payouts → CRA-ready ledger.
    let qr = svc.from("receipts").select(`
      id, status, amount, currency, reimbursable_amount, description, purchase_date, created_at,
      recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("org_id", orgCtx.id).eq("status", "approved");
    if (startISO) qr = qr.gte("created_at", startISO).lt("created_at", endISO);

    // Same missing-column trap as the payouts export above.
    let qp = svc.from("payouts").select(`
      *, recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("org_id", orgCtx.id).eq("status", "paid");
    if (startISO) qp = qp.gte("paid_at", startISO).lt("paid_at", endISO);

    const [rcp, pyo] = await Promise.all([qr, qp]);
    if (rcp.error) return NextResponse.json({ error: rcp.error.message }, { status: 500 });
    if (pyo.error) return NextResponse.json({ error: pyo.error.message }, { status: 500 });

    const rows: any[][] = [];
    for (const r of rcp.data ?? []) {
      rows.push([
        r.purchase_date || r.created_at?.slice(0, 10) || "",
        "Receipt (approved)",
        (r as any).recipients?.applications?.app_ref ?? "",
        (r as any).recipients?.applications?.parent_names ?? "",
        r.description ?? "",
        r.amount ?? 0,
        r.currency ?? "CAD",
        r.reimbursable_amount ?? "",
        "",
        "",
      ]);
    }
    for (const p of pyo.data ?? []) {
      rows.push([
        p.paid_at?.slice(0, 10) || p.created_at?.slice(0, 10) || "",
        "Payout (paid)",
        (p as any).recipients?.applications?.app_ref ?? "",
        (p as any).recipients?.applications?.parent_names ?? "",
        "",
        p.amount ?? 0,
        (p as any).currency ?? "CAD",
        "",
        p.payment_method ?? "",
        p.payment_reference ?? "",
      ]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    csv = toCsv(
      ["Date", "Type", "App ref", "Family", "Description", "Amount", "Currency", "Reimbursable (CAD)", "Method", "Reference"],
      rows
    );
    filename = exportFilename(orgCtx.slug, "transactions", year);

  } else if (kind === "applications") {
    // select("*") rather than a named column list on purpose: several columns
    // on this table (waitlisted, archived_at, archive_reason) exist in the
    // staging bootstrap but NOT in supabase/migrations, so naming them would
    // make this route 400 on any deployment whose schema hasn't caught up.
    // A data-portability feature is the last thing that should break on drift.
    let q = svc.from("applications").select("*")
      .eq("org_id", orgCtx.id).order("created_at", { ascending: false }).limit(5000);
    if (startISO) q = q.gte("created_at", startISO).lt("created_at", endISO);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as any[];
    // Answer keys vary per funnel version, so the columns are derived from the
    // rows themselves rather than hardcoded.
    const { columns, truncated } = answerColumns(rows, SITE_CONFIG.questions);
    if (truncated > 0) {
      console.warn(
        `[exports] applications: ${truncated} answer column(s) past the cap were omitted ` +
        `from their own columns — the full text is still in the Answers (JSON) column`,
      );
    }

    csv = toCsv(
      [
        "App ref", "Submitted", "Status", "Waitlisted", "Family", "City", "Email", "Phone",
        "Income range", "Current schooling", "Video link",
        "Address", "Province", "Postal code", "Mail consent", "Consent given",
        "Children count", "Children",
        ...columns.map((c) => c.header),
        "Decided", "Archived",
        // Always last, always complete — nothing is lost to the column cap or
        // to an unexpected shape in a legacy row.
        "Children (JSON)", "Answers (JSON, all keys)",
      ],
      rows.map((r) => [
        r.app_ref ?? "",
        r.created_at?.slice(0, 10) ?? "",
        r.status ?? "",
        r.waitlisted ? "yes" : "",
        r.parent_names ?? "",
        r.city ?? "",
        r.contact_email ?? "",
        r.contact_phone ?? "",
        r.income_range ?? "",
        r.current_schooling ?? "",
        r.video_link ?? "",
        r.address_street ?? "",
        r.address_province ?? "",
        r.address_postal ?? "",
        r.mail_consent ? "yes" : "no",
        r.mail_consent_at?.slice(0, 10) ?? "",
        childrenCount(r.children),
        childrenSummary(r.children),
        ...columns.map((c) => answerValue(r.answers, c.key)),
        r.decided_at?.slice(0, 10) ?? "",
        r.archived_at?.slice(0, 10) ?? "",
        JSON.stringify(r.children ?? []),
        JSON.stringify(r.answers ?? {}),
      ])
    );
    filename = exportFilename(orgCtx.slug, "applications", year);
  }

  return new NextResponse(csvBody(csv), { status: 200, headers: csvHeaders(filename) });
}
