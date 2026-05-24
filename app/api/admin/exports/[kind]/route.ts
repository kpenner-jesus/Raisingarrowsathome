// GET /api/admin/exports/[kind]?year=YYYY
//   kind: 'receipts' | 'payouts' | 'recipients' | 'transactions'
// Returns text/csv attachment. Admin only.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

const VALID_KINDS = new Set(["receipts", "payouts", "recipients", "transactions", "audit_log"]);

function csvField(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(arr: any[]): string { return arr.map(csvField).join(",") + "\n"; }

function toCsv(headers: string[], rows: any[][]): string {
  let out = csvRow(headers);
  for (const r of rows) out += csvRow(r);
  return out;
}

export async function GET(req: Request, ctx: { params: { kind: string } }) {
  const kind = ctx.params.kind;
  if (!VALID_KINDS.has(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
    `).order("created_at", { ascending: false });
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
    filename = `receipts${year ? `-${year}` : ""}.csv`;

  } else if (kind === "payouts") {
    let q = svc.from("payouts").select(`
      id, status, amount, currency, created_at, paid_at, payment_method, payment_reference,
      recipients!inner(applications!inner(parent_names, app_ref))
    `).order("created_at", { ascending: false });
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
        p.currency ?? "CAD",
        p.payment_method ?? "",
        p.payment_reference ?? "",
        p.status ?? "",
      ])
    );
    filename = `payouts${year ? `-${year}` : ""}.csv`;

  } else if (kind === "recipients") {
    const { data, error } = await svc.from("recipients").select(`
      id, status, reimbursement_rate, approved_amount, created_at, cohort_year,
      address_street, address_city, address_postal,
      applications!inner(parent_names, app_ref, contact_email, contact_phone, city)
    `).order("created_at", { ascending: false });
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
    filename = `recipients.csv`;

  } else if (kind === "audit_log") {
    let q = svc.from("audit_log").select(`
      created_at, action, target_table, target_id, details,
      profiles:actor_id(email)
    `).order("created_at", { ascending: false }).limit(5000);
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
    filename = `audit-log${year ? `-${year}` : ""}.csv`;

  } else if (kind === "transactions") {
    // Combined approved receipts + paid payouts → CRA-ready ledger.
    let qr = svc.from("receipts").select(`
      id, status, amount, currency, reimbursable_amount, description, purchase_date, created_at,
      recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("status", "approved");
    if (startISO) qr = qr.gte("created_at", startISO).lt("created_at", endISO);

    let qp = svc.from("payouts").select(`
      id, status, amount, currency, created_at, paid_at, payment_method, payment_reference,
      recipients!inner(applications!inner(parent_names, app_ref))
    `).eq("status", "paid");
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
        p.currency ?? "CAD",
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
    filename = `transactions${year ? `-${year}` : ""}.csv`;
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
