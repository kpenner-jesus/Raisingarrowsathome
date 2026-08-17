// POST /api/admin/broadcasts
//   body: { subject, body, audience, scheduled_for?: ISO string }
// If scheduled_for is set and in the future, row is queued and the
// daily cron dispatch will send it. Otherwise it sends immediately.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { runBroadcastSlice } from "@/app/lib/broadcasts";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

// Broadcasts are sent one at a time inside this request. Killed mid-loop, the
// row is stranded in state="sending" (the cron only ever retries "queued"), so
// some families received the email and some did not — and a manual re-send
// then re-mails everyone who already got it.
export const maxDuration = 300;

const VALID_AUDIENCES = new Set(["active_recipients", "all_recipients", "admins"]);

export async function POST(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;
  const svc = supabaseService();

  const body = await req.json().catch(() => ({} as any));
  const subject  = typeof body?.subject  === "string" ? body.subject.trim() : "";
  const html     = typeof body?.body     === "string" ? body.body : "";
  const audience = typeof body?.audience === "string" ? body.audience : "";
  const scheduledRaw = typeof body?.scheduled_for === "string" ? body.scheduled_for.trim() : "";

  if (!subject || subject.length > 200) return NextResponse.json({ error: "subject invalid" }, { status: 400 });
  if (!html    || html.length > 20_000) return NextResponse.json({ error: "body invalid" }, { status: 400 });
  if (!VALID_AUDIENCES.has(audience))   return NextResponse.json({ error: "audience invalid" }, { status: 400 });

  let scheduled_for: string | null = null;
  if (scheduledRaw) {
    const t = new Date(scheduledRaw);
    if (isNaN(t.getTime())) return NextResponse.json({ error: "scheduled_for invalid date" }, { status: 400 });
    if (t.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "scheduled_for must be in the future" }, { status: 400 });
    }
    scheduled_for = t.toISOString();
  }

  // Insert row first (queued or sending), then send if not scheduled.
  const initState = scheduled_for ? "queued" : "sending";
  const { data: row, error: insErr } = await svc.from("broadcasts").insert({
    org_id: orgCtx.id,
    sent_by: user.id, subject, body_html: html, audience,
    state: initState, scheduled_for, recipient_count: 0, failed_count: 0,
  }).select("id").single();
  if (insErr || !row) return NextResponse.json({ error: insErr?.message || "insert failed" }, { status: 500 });

  if (scheduled_for) {
    await writeAudit({
      orgId: orgCtx.id,
      actorId: user.id, action: "schedule_broadcast",
      targetTable: "broadcasts", targetId: row.id,
      details: { subject, audience, scheduled_for },
    });
    return NextResponse.json({ ok: true, queued: true, scheduled_for });
  }

  // Run ONE bounded slice, then hand back. Small audiences finish here and the
  // operator's experience is unchanged; a large one returns 202 and the browser
  // drives the rest, showing progress. Holding the response open for the whole
  // fan-out is what used to get the invocation killed mid-send.
  const r = await runBroadcastSlice({ broadcastId: row.id, orgId: orgCtx.id });
  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id, action: "send_broadcast",
    targetTable: "broadcasts", targetId: row.id,
    details: { subject, audience, sent: r.sent, failed: r.failed, total: r.total, done: r.done },
  });
  return NextResponse.json(
    {
      ok: true, broadcast_id: row.id,
      done: r.done, sent: r.sent, failed: r.failed, pending: r.pending, total: r.total,
      degraded: r.degraded,
    },
    { status: r.done ? 200 : 202 },
  );
}
