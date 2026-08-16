// /admin/email-templates — DB-editable transactional email copy.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { TemplateEditor } from "./TemplateEditor";

export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage() {
  const ctx = await requireOrgContext();
  const svc = supabaseService();
  // Archived templates are retired copy — hidden here, and skipped at send
  // time by loadTemplate(). They can be brought back from the admin chat
  // (archive_email_template with restore: true).
  const { data } = await svc.from("email_templates")
    .select("key, label, subject, body_html, body_text, vars, updated_at")
    .eq("org_id", ctx.id)
    .is("archived_at", null)
    .order("label");

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Words we send</span>
          <h1 className="ra-h1">Email templates</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Edit subject + body for every transactional email. Variables wrap in <code>{"{{name}}"}</code>.
          </p>
        </div>
      </header>
      <TemplateEditor templates={(data as any[]) ?? []} />
    </div>
  );
}
