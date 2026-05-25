// GET /api/public/intake-status
// Public, cache-control 5 min. Returns current intake status so the
// apply funnel can show the right banner without breaking the static
// build for the page.
import { NextResponse } from "next/server";
import { getSettings } from "@/app/lib/settings";
import { getOrgContext } from "@/app/lib/org-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // status depends on the tenant the
                                          // host resolves to; can't be static.

export async function GET() {
  const orgCtx = await getOrgContext();
  // No tenant resolved (e.g. signup marketing host) — treat intake as open
  // by returning DEFAULTS via getSettings() with no orgId.
  const s = await getSettings(orgCtx?.id);
  return NextResponse.json(
    { status: s.intakeStatus },
    {
      headers: {
        // Per-tenant content: scope cache key by the resolved org so
        // tenant A's "closed" doesn't get served to tenant B.
        "Cache-Control": "private, max-age=300",
        ...(orgCtx ? { "X-Org-Slug": orgCtx.slug } : {}),
      },
    }
  );
}
