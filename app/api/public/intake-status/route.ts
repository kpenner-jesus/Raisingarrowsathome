// GET /api/public/intake-status
// Public, cache-control 5 min. Returns current intake status so the
// apply funnel can show the right banner without breaking the static
// build for the page.
import { NextResponse } from "next/server";
import { getSettings } from "@/app/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSettings();
  return NextResponse.json(
    { status: s.intakeStatus },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
