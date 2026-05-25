// /portal/profile — recipient self-edit of phone + address.
// Email is read-only (auth-tied; change requires admin help).
// Parent names are read-only (CRA-significant on file).
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getEffectiveRecipient } from "@/app/lib/impersonation";
import { requireOrgContext } from "@/app/lib/org-context";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=%2Fportal%2Fprofile");

  const orgCtx = await requireOrgContext();

  // Impersonation-aware lookup. When an admin is viewing as the test
  // grantee the helper returns the test recipient row instead of the
  // admin's own (typically non-existent) profile-linked recipient.
  const ctx = await getEffectiveRecipient(user.id, orgCtx.id);
  const svc = supabaseService();

  // Re-query with the wider projection this page needs (parent_names etc).
  // Returns null when no recipient resolves OR the row was concurrently deleted.
  async function loadProfileRecipient(recipientId: string) {
    const { data } = await svc.from("recipients")
      .select(`
        id, address_street, address_city, address_postal,
        applications!inner(id, parent_names, contact_email, contact_phone, city)
      `)
      .eq("id", recipientId)
      .maybeSingle();
    return data;
  }

  const recipient = ctx.recipient ? await loadProfileRecipient(ctx.recipient.id) : null;

  if (!recipient) {
    return (
      <div>
        <h1 className="ra-h1" style={{ marginBottom: "0.5rem" }}>Profile</h1>
        <p className="ra-quiet">No active recipient record on file. Contact <a href="mailto:register@raisingarrowsathome.com">register@raisingarrowsathome.com</a> if you believe this is an error.</p>
      </div>
    );
  }

  const app = (recipient as any).applications;

  return (
    <div>
      <h1 className="ra-h1" style={{ marginBottom: "0.5rem" }}>Profile</h1>
      <p className="ra-quiet" style={{ marginBottom: "1.5rem" }}>
        Keep your contact info current so e-transfers and receipt decisions reach you.
      </p>

      <ProfileForm
        recipientId={(recipient as any).id}
        applicationId={app.id}
        initial={{
          parent_names:   app.parent_names ?? "",
          contact_email:  app.contact_email ?? user.email ?? "",
          contact_phone:  app.contact_phone ?? "",
          city:           app.city ?? "",
          address_street: (recipient as any).address_street ?? "",
          address_city:   (recipient as any).address_city ?? app.city ?? "",
          address_postal: (recipient as any).address_postal ?? "",
        }}
      />
    </div>
  );
}
