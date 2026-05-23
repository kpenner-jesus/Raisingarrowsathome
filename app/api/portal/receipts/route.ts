// POST /api/portal/receipts — recipient submits a receipt record after uploading the file
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: recipient } = await supabase
    .from("recipients").select("id").eq("profile_id", user.id).maybeSingle();
  if (!recipient) return new NextResponse("no recipient linked to this account", { status: 400 });

  const { image_path, amount, purchase_date, description } = await req.json();
  if (!image_path || !amount) return new NextResponse("missing fields", { status: 400 });
  if (Number(amount) <= 0)    return new NextResponse("amount must be positive", { status: 400 });

  const { error } = await supabase.from("receipts").insert({
    recipient_id: recipient.id,
    image_path,
    amount,
    purchase_date,
    description,
    status: "pending",
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
