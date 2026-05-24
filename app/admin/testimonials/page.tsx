// /admin/testimonials — review/approve/hide submitted testimonials.
import { supabaseService } from "@/app/lib/supabase/server";
import { TestimonialManager } from "./TestimonialManager";

export const dynamic = "force-dynamic";

export default async function TestimonialsPage({ searchParams }: {
  searchParams?: { status?: string };
}) {
  const svc = supabaseService();
  const status = searchParams?.status ?? "pending";

  let q = svc.from("testimonials").select(`
    id, body, status, featured, created_at, reviewed_at,
    recipients!inner(applications!inner(parent_names, app_ref, city))
  `).order("created_at", { ascending: false });

  if (status !== "all") q = q.eq("status", status);
  const { data } = await q;

  const counts: any = await Promise.all([
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("status", "pending"),
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("status", "approved"),
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("status", "hidden"),
  ]);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Voice of recipients</span>
          <h1 className="ra-h1">Testimonials</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Review family quotes. Approve to allow display, feature to highlight, hide to remove from rotation.
          </p>
        </div>
      </header>

      <div className="ra-tabs" style={{ marginBottom: "1.25rem" }}>
        <a href="/admin/testimonials?status=pending"  className={`ra-tab ${status === "pending"  ? "ra-tab-active" : ""}`}>Pending ({counts[0].count ?? 0})</a>
        <a href="/admin/testimonials?status=approved" className={`ra-tab ${status === "approved" ? "ra-tab-active" : ""}`}>Approved ({counts[1].count ?? 0})</a>
        <a href="/admin/testimonials?status=hidden"   className={`ra-tab ${status === "hidden"   ? "ra-tab-active" : ""}`}>Hidden ({counts[2].count ?? 0})</a>
        <a href="/admin/testimonials?status=all"      className={`ra-tab ${status === "all"      ? "ra-tab-active" : ""}`}>All</a>
      </div>

      <TestimonialManager items={(data as any[] ?? []) as any} />
    </div>
  );
}
