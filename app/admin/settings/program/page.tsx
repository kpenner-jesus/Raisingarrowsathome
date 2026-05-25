// /admin/settings — edit DB-backed runtime settings.
import { getSettings } from "@/app/lib/settings";
import { requireOrgContext } from "@/app/lib/org-context";
import { SettingsForm } from "../SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const s = await getSettings(ctx.id);
  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Program controls</span>
          <h1 className="ra-h1">Settings</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Change funding caps, reimbursement rate, deadline, and intake status. Takes effect immediately — no code deploy.
          </p>
        </div>
      </header>
      <SettingsForm initial={s} />
    </div>
  );
}
