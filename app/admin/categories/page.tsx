// /admin/categories — curate the receipt-category dropdown.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { CategoriesEditor } from "./CategoriesEditor";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const ctx = await requireOrgContext();
  const svc = supabaseService();
  const { data } = await svc.from("receipt_categories")
    .select("id, label, sort_order, archived_at")
    .eq("org_id", ctx.id)
    .order("sort_order");

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Catalogue</span>
          <h1 className="ra-h1">Receipt categories</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Edit the dropdown families pick from when uploading a receipt. Archive instead of deleting so historical receipts keep their category.
          </p>
        </div>
      </header>
      <CategoriesEditor items={(data as any[]) ?? []} />
    </div>
  );
}
