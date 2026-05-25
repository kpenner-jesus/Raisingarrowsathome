import { NextResponse } from "next/server";
import { decideApplication } from "@/app/lib/admin/decide-application";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { user, ctx } = auth;

  const { decision, approved_amount, rate, notes } = await req.json();
  if (!["approved", "denied"].includes(decision)) return new NextResponse("bad decision", { status: 400 });

  try {
    const result = await decideApplication({
      orgId:            ctx.id,
      applicationId:    params.id,
      decision,
      approved_amount,
      rate,
      notes,
      deciderProfileId: user.id,
      origin:           new URL(req.url).origin,
    });
    await writeAudit({
      orgId:       ctx.id,
      actorId:     user.id,
      action:      "decide_application",
      targetTable: "applications",
      targetId:    params.id,
      details:     { decision, approved_amount, rate, notes: notes ?? null, recipient_id: (result as any)?.recipientId ?? null },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return new NextResponse(e?.message || "decide failed", { status: 500 });
  }
}
