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
  //
  // select("*") + filter in JS, deliberately: migrations are applied by hand
  // here, so this code can run against a database where archived_at does not
  // exist yet. Naming the column in select/filter would be a hard PostgREST
  // error and the page would render "No templates defined" — worse than
  // showing an archived one. Undefined column reads as "not archived".
  const { data } = await svc.from("email_templates")
    .select("*")
    .eq("org_id", ctx.id)
    .order("label");
  const templates = (data as any[] ?? []).filter((t) => !t.archived_at);

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
      <TemplateEditor templates={templates} />
    </div>
  );
}
