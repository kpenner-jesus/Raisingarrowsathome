// PATCH /api/admin/recipients/[id]
// Admin updates approved_amount, reimbursement_rate, and/or status.
//
// Strict numeric validation + upper bound on approved_amount to prevent
// fat-finger or compromised-token disasters.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

const ALLOWED_STATUS = ["active", "completed", "suspended"] as const;
const MAX_CAP = 50_000;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const update: Record<string, any> = {};

  if (body.approved_amount !== undefined) {
    const n = Number(body.approved_amount);
    if (!Number.isFinite(n) || n < 0) return new NextResponse("approved_amount must be a non-negative finite number", { status: 400 });
    if (n > MAX_CAP)                   return new NextResponse(`approved_amount exceeds maximum (${MAX_CAP})`, { status: 400 });
    update.approved_amount = n;
  }
  if (body.reimbursement_rate !== undefined) {
    const n = Number(body.reimbursement_rate);
    if (!Number.isFinite(n) || n < 0 || n > 1) return new NextResponse("reimbursement_rate must be 0–1", { status: 400 });
    update.reimbursement_rate = n;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) return new NextResponse("invalid status", { status: 400 });
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return new NextResponse("nothing to update", { status: 400 });
  }

  const service = supabaseService();
  const { error } = await service.from("recipients").update(update).eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
