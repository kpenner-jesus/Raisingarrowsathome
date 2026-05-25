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
    // Use the trusted platform URL for invite redirects + portal links inside
    // transactional emails so they land on THIS tenant's portal even when an
    // admin is calling from a path-routed URL (where origin is the bare host).
    const platformOrigin = process.env.NEXT_PUBLIC_PLATFORM_URL || new URL(req.url).origin;
    const result = await decideApplication({
      orgId:            ctx.id,
      orgSlug:          ctx.slug,
      applicationId:    params.id,
      decision,
      approved_amount,
      rate,
      notes,
      deciderProfileId: user.id,
      origin:           platformOrigin,
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
