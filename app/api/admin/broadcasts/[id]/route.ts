// GET  /api/admin/broadcasts/[id]  → progress for the admin UI to poll
// POST /api/admin/broadcasts/[id]  → run one more slice (the "pump"), or
//                                    ?action=retry_failed
//
// Every lookup is scoped to the caller's tenant. The id comes from the URL, so
// without that scope an admin of one charity could drive another charity's
// broadcast.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { supabaseService } from "@/app/lib/supabase/server";
import { runBroadcastSlice } from "@/app/lib/broadcasts";
import { deriveBroadcastStatus } from "@/app/lib/broadcast-logic";
import { writeAudit } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;

async function loadScoped(id: string, orgId: string) {
  const svc = supabaseService();
  // select("*") on purpose: naming the new columns would 400 the whole query
  // on a database that hasn't had the migration applied yet.
  const { data } = await svc.from("broadcasts").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  return data as any;
}

async function counts(id: string) {
  const svc = supabaseService();
  const one = async (status: string) => {
    const { count, error } = await svc.from("broadcast_sends")
      .select("id", { head: true, count: "exact" }).eq("broadcast_id", id).eq("status", status);
    return error ? 0 : (count ?? 0);
  };
  const [sent, failed, pending] = await Promise.all([one("sent"), one("failed"), one("pending")]);
  return { sent, failed, pending };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const row = await loadScoped(params.id, auth.ctx.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const c = await counts(params.id);
  const status = deriveBroadcastStatus({
    state: row.state, materialized_at: row.materialized_at, progress_at: row.progress_at,
    scheduled_for: row.scheduled_for, total: row.total_count ?? null,
    ...c, nowMs: Date.now(),
  });

  // A few examples of what went wrong, so "12 failed" is actionable.
  const svc = supabaseService();
  const { data: failures } = await svc.from("broadcast_sends")
    .select("email, last_error, attempts").eq("broadcast_id", params.id).eq("status", "failed").limit(20);

  return NextResponse.json({ id: params.id, ...c, total: row.total_count ?? null, status, failures: failures ?? [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const orgId = auth.ctx.id;
  const row = await loadScoped(params.id, orgId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const action = new URL(req.url).searchParams.get("action");

  if (action === "retry_failed") {
    // Only failed rows, and only those under the attempts cap — a single
    // button that re-mails everyone is the disaster this whole change exists
    // to prevent.
    const svc = supabaseService();
    const { data: reset, error } = await svc.from("broadcast_sends")
      .update({ status: "pending", last_error: null })
      .eq("broadcast_id", params.id).eq("org_id", orgId)
      .eq("status", "failed").lt("attempts", MAX_ATTEMPTS)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit({
      orgId, actorId: auth.user.id, action: "retry_broadcast_failures",
      targetTable: "broadcasts", targetId: params.id, details: { requeued: reset?.length ?? 0 },
    }).catch(() => {});
    if ((reset?.length ?? 0) === 0) {
      return NextResponse.json({ ok: true, requeued: 0, note: "Nothing to retry — those addresses have already been tried the maximum number of times." });
    }
  }

  const r = await runBroadcastSlice({ broadcastId: params.id, orgId });
  return NextResponse.json({
    ok: true, done: r.done, sent: r.sent, failed: r.failed, pending: r.pending,
    total: r.total, skipped: r.skipped, degraded: r.degraded,
  }, { status: r.done ? 200 : 202 });
}
