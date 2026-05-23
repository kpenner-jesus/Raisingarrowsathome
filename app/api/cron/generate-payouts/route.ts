// ============================================================
//  GET /api/cron/generate-payouts
//
//  Vercel Cron entry point. Set schedule in vercel.json.
//
//  Auth: Authorization header must equal exactly `Bearer ${CRON_SECRET}`.
//        Compared with timingSafeEqual to avoid timing-leak side channels
//        and substring-acceptance bugs.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const auth   = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return new NextResponse("server misconfigured: CRON_SECRET unset", { status: 500 });
  }
  const expected = `Bearer ${secret}`;
  if (!constantTimeEq(auth, expected)) {
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
