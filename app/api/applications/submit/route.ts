// ============================================================
//  POST /api/applications/submit
//
//  Called by the public apply funnel after the review-page email
//  is sent. Persists the application to Supabase so admin can
//  review and approve/deny.
// ============================================================

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      app_ref, parent_names, city, contact_email, contact_phone,
      income_range, current_schooling, children, answers, video_link,
    } = body;

    if (!app_ref || !parent_names || !contact_email) {
      return new NextResponse("missing required fields", { status: 400 });
    }

    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("applications")
      .insert({
        app_ref,
        parent_names,
        city,
        contact_email,
        contact_phone,
        income_range,
        current_schooling,
        children,
        answers,
        video_link,
      })
      .select("id")
      .single();
    if (error) return new NextResponse(error.message, { status: 500 });

    return NextResponse.json({ id: data.id });
  } catch (e: any) {
    return new NextResponse(e?.message || "error", { status: 500 });
  }
}
