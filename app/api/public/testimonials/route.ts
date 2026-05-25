// GET /api/public/testimonials
// Returns approved testimonials with a sanitized attribution string
// (first names + city). Featured ones bubble to the top.
//
// Public — no auth — but body content is admin-curated via the
// /admin/testimonials approve flow before it ever surfaces here.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { getOrgContext } from "@/app/lib/org-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";  // tenant resolution must happen
                                         // per request — can't be static.

function firstNamesOnly(parent_names: string | null | undefined): string {
  if (!parent_names) return "";
  // "Sarah and Tim Penner" → "Sarah & Tim"; "Jordan Hammond" → "Jordan"
  const noLast = parent_names.replace(/\s+\S+$/, "").trim();
  return noLast.replace(/\s+and\s+/i, " & ");
}

export async function GET() {
  try {
    // No tenant resolved → return an empty list rather than leaking
    // cross-tenant testimonials. This route is mounted under a per-tenant
    // host or /o/<slug>/ path, so the marketing/signup host should never
    // call it.
    const orgCtx = await getOrgContext();
    if (!orgCtx) return NextResponse.json({ items: [] });

    const svc = supabaseService();
    const { data, error } = await svc.from("testimonials")
      .select(`id, body, featured, created_at,
        recipients!inner(applications!inner(parent_names, city))`)
      .eq("org_id", orgCtx.id)
      .eq("status", "approved")
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return NextResponse.json({ items: [], error: error.message }, { status: 500 });

    const items = (data ?? []).map((r: any) => {
      const fam  = firstNamesOnly(r.recipients?.applications?.parent_names);
      const city = (r.recipients?.applications?.city || "").trim();
      return {
        id: r.id,
        body: r.body,
        featured: !!r.featured,
        attribution: [fam, city].filter(Boolean).join(" · "),
      };
    });

    return NextResponse.json({ items }, {
      headers: {
        // Modest cache — but private since responses differ per tenant.
        "Cache-Control": "private, max-age=300",
        "X-Org-Slug":    orgCtx.slug,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: e?.message ?? "fetch failed" }, { status: 500 });
  }
}
