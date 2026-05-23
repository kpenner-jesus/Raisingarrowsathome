"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_components/Toaster";

export default function InviteForm() {
  const router = useRouter();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState<"admin" | "super_admin">("admin");
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    if (!email.includes("@")) { notify("Invalid email", "error"); return; }
    setBusy(true);
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setBusy(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    notify(`Invited ${email} as ${role}`);
    setEmail("");
    router.refresh();
  };

  return (
    <div className="ra-row" style={{ alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 240px" }}>
        <label className="ra-label">Email</label>
        <input
          type="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="ra-input" placeholder="newadmin@example.com"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
      </div>
      <div>
        <label className="ra-label">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="ra-select">
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
      </div>
      <button onClick={submit} disabled={busy || !email} className="ra-btn ra-btn-accent">
        {busy ? "Inviting…" : "Send invite"}
      </button>
      <p className="ra-tiny" style={{ width: "100%", marginTop: "0.35rem" }}>
        The new user signs in via magic link at <code>/auth/login</code>. They&apos;ll land on <code>/admin</code> after first sign-in.
      </p>
    </div>
  );
}
