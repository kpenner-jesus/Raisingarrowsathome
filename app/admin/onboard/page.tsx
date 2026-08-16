// Legacy path. The invite page moved to /auth/accept-invite because this one
// sat under the admin layout, which redirects anyone without an org_members
// row — the exact state an invitee is in. Invites already in inboxes still
// point here, so forward them (token intact) rather than 404.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyOnboardRedirect({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token;
  redirect(`/auth/accept-invite${token ? `?token=${encodeURIComponent(token)}` : ""}`);
}
