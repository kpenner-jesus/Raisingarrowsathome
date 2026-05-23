// GET /api/public/testimonials
// Returns approved testimonials with a sanitized attribution string
// (first names + city). Featured ones bubble to the top.
//
// Public — no auth — but body content is admin-curated via the
// /admin/testimonials approve flow before it ever surfaces here.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";

export const runtime = "nodejs";

function firstNamesOnly(parent_names: string | null | undefined): string {
  if (!parent_names) return "";
  // "Sarah and Tim Penner" → "Sarah & Tim"; "Jordan Hammond" → "Jordan"
  const noLast = parent_names.replace(/\s+\S+$/, "").trim();
  return noLast.replace(/\s+and\s+/i, " & ");
}

export async function GET() {
  try {
    const svc = supabaseService();
    const { data, error } = await svc.from("testimonials")
      .select(`id, body, featured, created_at,
        recipients!inner(applications!inner(parent_names, city))`)
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
        // Modest CDN cache — admin-flipping approval picks up within 5 min
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: e?.message ?? "fetch failed" }, { status: 500 });
  }
}
