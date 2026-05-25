// POST /api/portal/testimonials — recipient submits a written testimonial
// Impersonation-aware: admin viewing as test grantee writes to the test row.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const ctx = await getEffectiveRecipient(user.id);
  const recipient = ctx.recipient;
  if (!recipient) return new NextResponse("no recipient", { status: 400 });

  const { body } = await req.json();
  if (!body?.trim()) return new NextResponse("empty body", { status: 400 });

  // org_id from the recipient row pins the testimonial to the right tenant.
  const writeClient = ctx.mode === "impersonating" ? supabaseService() : supabase;
  const { error } = await writeClient.from("testimonials").insert({
    org_id:       recipient.org_id,
    recipient_id: recipient.id,
    body:         body.trim(),
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
