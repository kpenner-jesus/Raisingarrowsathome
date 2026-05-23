// ============================================================
//  GET /api/cron/generate-payouts
//
//  Vercel Cron entry point. Set schedule in vercel.json.
//  Authenticated via CRON_SECRET in the Authorization header.
// ============================================================

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth   = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  // Vercel sends "Bearer <CRON_SECRET>" when you set it as a project env var.
  if (!secret || !auth.includes(secret)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const res = await fetch(`${url.origin}/api/admin/payouts/generate`, {
    method:  "POST",
    headers: { "x-cron-secret": secret },
  });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
}
