// ============================================================
//  Audit log writer
//
//  Inserts a row into public.audit_log via the service role so the
//  write is always allowed even if RLS rules tighten later. Every
//  admin-side mutation route should call this immediately after a
//  successful change.
//
//  CRA audit guidance: keep at minimum  who / what / when / before+after.
//  We store before/after diffs (and any free-form context) in `details`
//  JSONB.
// ============================================================

import { supabaseService } from "./supabase/server";

export type AuditAction =
  | "decide_application"
  | "decide_receipt"
  | "mark_paid"
  | "modify_recipient"
  | "approve_testimonial"
  | "hide_testimonial"
  | "feature_testimonial"
  | "update_settings"
  | "add_note"
  | "delete_note"
  | "create_recipient"
  | "delete_recipient"
  | string; // allow extension without code change

export interface AuditEntry {
  /** Org/tenant this audit row belongs to. Required — audit_log is tenant-scoped. */
  orgId: string;
  actorId: string | null;
  action: AuditAction;
  targetTable: string;
  targetId: string;
  details?: Record<string, any>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const svc = supabaseService();
    const { error } = await svc.from("audit_log").insert({
      org_id:       entry.orgId,
      actor_id:     entry.actorId,
      action:       entry.action,
      target_table: entry.targetTable,
      target_id:    entry.targetId,
      details:      entry.details ?? {},
    });
    if (error) {
      // Don't fail the parent request — log and continue. Audit gaps
      // are visible from the viewer so we can backfill if needed.
      console.error("[audit] write failed:", error.message, entry);
    }
  } catch (e) {
    console.error("[audit] write threw:", e);
  }
}

/** Convenience: diff two flat records and return only changed keys. */
export function diff(before: Record<string, any>, after: Record<string, any>): Record<string, { from: any; to: any }> {
  const out: Record<string, { from: any; to: any }> = {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out[k] = { from: before[k], to: after[k] };
    }
  }
  return out;
}
