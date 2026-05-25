// PATCH /api/admin/settings — admin updates funding caps, rate, deadline, open flag.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const ALLOWED_KEYS = new Set([
  "funding_caps",
  "reimbursement_rate",
  "submission_deadline_months",
  "applications_open",   // legacy, kept for now
  "intake_status",       // 'open' | 'waitlist' | 'closed'
]);

interface UpdatePayload {
  updates: Record<string, any>;
}

function isFiniteNumber(n: any): n is number {
  return typeof n === "number" && isFinite(n);
}

function validate(key: string, value: any): string | null {
  switch (key) {
    case "funding_caps":
      if (!Array.isArray(value)) return "funding_caps must be array";
      for (const t of value) {
        if (typeof t?.label !== "string" || !t.label.trim()) return "funding_caps.label invalid";
        if (!isFiniteNumber(t.cap)   || t.cap   < 0 || t.cap   > 10000) return "funding_caps.cap invalid";
        if (!isFiniteNumber(t.spend) || t.spend < 0 || t.spend > 20000) return "funding_caps.spend invalid";
      }
      return null;
    case "reimbursement_rate":
      if (!isFiniteNumber(value) || value < 0 || value > 1) return "reimbursement_rate must be 0..1";
      return null;
    case "submission_deadline_months":
      if (!isFiniteNumber(value) || value < 1 || value > 36 || Math.floor(value) !== value) {
        return "submission_deadline_months must be integer 1..36";
      }
      return null;
    case "applications_open":
      if (typeof value !== "boolean") return "applications_open must be boolean";
      return null;
    case "intake_status":
      if (value !== "open" && value !== "waitlist" && value !== "closed") {
        return "intake_status must be open|waitlist|closed";
      }
      return null;
    default:
      return "unknown key";
  }
}

export async function PATCH(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;
  const svc = supabaseService();

  let body: UpdatePayload;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!body?.updates || typeof body.updates !== "object") {
    return NextResponse.json({ error: "updates required" }, { status: 400 });
  }

  // Capture before-state for audit
  const keys = Object.keys(body.updates).filter((k) => ALLOWED_KEYS.has(k));
  if (keys.length === 0) return NextResponse.json({ error: "no valid keys" }, { status: 400 });

  for (const k of keys) {
    const err = validate(k, body.updates[k]);
    if (err) return NextResponse.json({ error: `${k}: ${err}` }, { status: 400 });
  }

  // Per-tenant settings (app_settings uses UNIQUE(org_id, key) constraint
  // after the multi-tenant migration). Scope before/after to this org.
  const { data: before } = await svc.from("app_settings")
    .select("key, value").eq("org_id", orgCtx.id).in("key", keys);
  const beforeMap = new Map((before ?? []).map((r: any) => [r.key, r.value]));

  // Upsert each key
  const rows = keys.map((k) => ({
    org_id:     orgCtx.id,
    key:        k,
    value:      body.updates[k],
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }));
  const { error: upErr } = await svc.from("app_settings")
    .upsert(rows, { onConflict: "org_id,key" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Audit one entry per changed key
  for (const k of keys) {
    await writeAudit({
      orgId: orgCtx.id,
      actorId: user.id,
      action: "update_settings",
      targetTable: "app_settings",
      targetId: k,
      details: { from: beforeMap.get(k) ?? null, to: body.updates[k] },
    });
  }

  return NextResponse.json({ ok: true, updated: keys });
}
