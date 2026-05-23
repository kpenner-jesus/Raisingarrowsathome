// GET /api/health
// Public uptime endpoint for UptimeRobot / Pingdom / status pages.
// Pings Supabase + confirms key env is present. Returns:
//   200 { ok: true,  db: 'ok', time, latency_ms }
//   503 { ok: false, db: 'fail'|'env_missing', ... }
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const t0 = Date.now();
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, db: "env_missing", missing, time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Cheapest possible read: count(*) from a small static-ish table.
  try {
    const svc = supabaseService();
    const { error } = await svc.from("app_settings").select("key", { count: "exact", head: true });
    if (error) {
      return NextResponse.json(
        { ok: false, db: "fail", error: error.message, time: new Date().toISOString(), latency_ms: Date.now() - t0 },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { ok: true, db: "ok", time: new Date().toISOString(), latency_ms: Date.now() - t0 },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, db: "fail", error: e?.message ?? "unknown", time: new Date().toISOString(), latency_ms: Date.now() - t0 },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
