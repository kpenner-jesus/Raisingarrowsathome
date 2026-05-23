"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_components/Toaster";
import { ConfirmModal } from "../_components/ConfirmModal";

interface Member {
  id: string;
  email: string;
  role: "admin" | "super_admin";
  created_at: string;
  last_sign_in_at: string | null;
}

export default function TeamRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const setRole = async (newRole: "admin" | "super_admin") => {
    if (newRole === member.role) return;
    setBusy(true);
    const res = await fetch(`/api/admin/team/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    setBusy(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    notify(`${member.email} → ${newRole}`);
    router.refresh();
  };

  const revoke = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/team/${member.id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmRevoke(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    notify(`${member.email} revoked`);
    router.refresh();
  };

  return (
    <>
      <tr>
        <td>
          <span style={{ fontWeight: 500 }}>{member.email}</span>
          {isSelf && <span className="ra-tiny" style={{ marginLeft: "0.5rem", color: "var(--ra-ink-muted)" }}>(you)</span>}
        </td>
        <td>
          <select
            value={member.role}
            disabled={busy || isSelf}
            onChange={(e) => setRole(e.target.value as any)}
            className="ra-select"
            style={{ maxWidth: 150 }}
          >
            <option value="admin">admin</option>
            <option value="super_admin">super_admin</option>
          </select>
        </td>
        <td className="ra-tiny">{new Date(member.created_at).toLocaleDateString("en-CA")}</td>
        <td className="ra-tiny">
          {member.last_sign_in_at
            ? new Date(member.last_sign_in_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
            : <span className="ra-quiet">never</span>}
        </td>
        <td style={{ textAlign: "right" }}>
          {!isSelf && (
            <button
              onClick={() => setConfirmRevoke(true)}
              disabled={busy}
              className="ra-btn ra-btn-danger ra-btn-sm"
            >
              Revoke
            </button>
          )}
        </td>
      </tr>

      <ConfirmModal
        open={confirmRevoke}
        title={`Revoke admin access from ${member.email}?`}
        body="They will be demoted to 'recipient' and lose all admin/team access. MCP tokens they own are NOT auto-revoked — handle those separately if needed."
        confirmLabel="Revoke"
        destructive
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setConfirmRevoke(false)}
      />
    </>
  );
}
