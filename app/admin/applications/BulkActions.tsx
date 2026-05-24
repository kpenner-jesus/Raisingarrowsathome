"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AvatarRow } from "../_components/Avatar";
import { StatusBadge } from "../_components/StatusBadge";

interface Row {
  id: string;
  app_ref: string;
  parent_names: string;
  city: string;
  contact_email: string;
  status: string;
  created_at: string;
  children: any[] | null;
}

interface SortInfo {
  col: string;
  dir: "asc" | "desc";
  /** Preserved URL params (status, q, etc) — included in every sort link */
  extra: Record<string, string | undefined>;
}

/** Inline sortable <th> for the bulk-aware applications table. */
function SortTh({ label, col, sort, align = "left" }: {
  label: string; col: string; sort?: SortInfo; align?: "left" | "right" | "center";
}) {
  if (!sort) return <th style={{ textAlign: align }}>{label}</th>;
  const isActive = sort.col === col;
  const nextDir: "asc" | "desc" = isActive ? (sort.dir === "asc" ? "desc" : "asc") : "asc";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sort.extra)) {
    if (v) params.set(k, v);
  }
  params.set("sort", col);
  params.set("dir", nextDir);
  const arrow = isActive ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th style={{ textAlign: align }}>
      <Link href={`/admin/applications?${params.toString()}`}
        style={{ color: "inherit", textDecoration: "none", fontWeight: 600, cursor: "pointer", opacity: isActive ? 1 : 0.85 }}
        title={`Sort by ${label} (${nextDir})`}>
        {label}{arrow}
      </Link>
    </th>
  );
}

export function ApplicationsTable({ rows, sort }: { rows: Row[]; sort?: SortInfo }) {
  const router = useRouter();
  const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");

  function toggle(id: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((curr) => curr.size === pendingIds.length ? new Set() : new Set(pendingIds));
  }
  async function bulkDeny() {
    if (!reason.trim()) { setError("Please tell the families why first."); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/applications/bulk-deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), notes: reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setDenyOpen(false); setSelected(new Set()); setReason("");
      router.refresh();
      // Surface email outcome on the rendered toast (best-effort)
      if (typeof window !== "undefined") {
        const emailNote = (j.emailed != null)
          ? ` ${j.emailed} got an email${j.failed ? `, ${j.failed} couldn't be reached` : ""}.`
          : "";
        try { (window as any).alert(`Done. Turned down ${j.denied_count} famil${j.denied_count === 1 ? "y" : "ies"}.${emailNote}`); } catch {}
      }
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {pendingIds.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
          marginTop: "0.85rem", marginBottom: "0.5rem",
          padding: "0.5rem 0.85rem", borderRadius: 8,
          background: selected.size > 0 ? "rgba(232,121,58,0.08)" : "var(--ra-bg-soft)",
          border: "1px solid var(--ra-line)",
        }}>
          <span className="ra-tiny">{selected.size} selected of {pendingIds.length} pending</span>
          <div style={{ flex: 1 }} />
          <button className="ra-btn" disabled={selected.size === 0 || busy} onClick={() => setDenyOpen(true)}>
            Deny selected
          </button>
        </div>
      )}

      <div className="ra-table-card" style={{ marginTop: pendingIds.length === 0 ? "1rem" : 0 }}>
        <table className="ra-table">
          <thead>
            <tr>
              {pendingIds.length > 0 && (
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={selected.size === pendingIds.length && pendingIds.length > 0}
                    onChange={toggleAll}
                    title="Select all pending" />
                </th>
              )}
              <SortTh label="Family" col="family"     sort={sort} />
              <th>Ref</th>
              <th>Kids</th>
              <SortTh label="Status" col="status"     sort={sort} />
              <SortTh label="Submitted" col="created" sort={sort} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const kids = Array.isArray(a.children) ? a.children : [];
              const canSelect = a.status === "pending";
              return (
                <tr key={a.id}>
                  {pendingIds.length > 0 && (
                    <td>
                      {canSelect ? (
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                      ) : null}
                    </td>
                  )}
                  <td>
                    <Link href={`/admin/applications/${a.id}`}>
                      <AvatarRow name={a.parent_names} secondary={a.city + " · " + a.contact_email} />
                    </Link>
                  </td>
                  <td className="ra-tiny" style={{ fontFamily: "ui-monospace, monospace" }}>{a.app_ref}</td>
                  <td>
                    {kids.length > 0 ? (
                      <span className="ra-quiet">
                        {kids.length} · ages {kids.map((c: any) => c.age).join(", ")}
                      </span>
                    ) : <span className="ra-quiet">—</span>}
                  </td>
                  <td><StatusBadge status={a.status} /></td>
                  <td style={{ textAlign: "right" }} className="ra-tiny">
                    {new Date(a.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="ra-empty">
                    <div className="ra-empty-icon">✉</div>
                    <div className="ra-empty-title">No applications match</div>
                    <div>Try clearing filters or wait for new submissions.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {denyOpen && (
        <div onClick={() => !busy && setDenyOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)",
            zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, padding: "1.5rem", maxWidth: 480, width: "100%" }}>
            <h3 className="ra-h2" style={{ marginBottom: "0.5rem" }}>
              Turn down {selected.size} famil{selected.size !== 1 ? "ies" : "y"}?
            </h3>
            <p className="ra-quiet" style={{ marginTop: 0 }}>
              The message you write below will be emailed to each family.
              Be kind — many of them are stretching just to apply.
            </p>
            <label className="ra-label">Message to the families</label>
            <textarea
              className="ra-input ra-textarea"
              rows={4}
              maxLength={1000}
              placeholder="Example: We've received more applications than we can fund this round. We hope to see you back next year."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && <div className="ra-alert-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="ra-btn" disabled={busy} onClick={() => setDenyOpen(false)}>Never mind</button>
              <button className="ra-btn ra-btn-primary" disabled={busy || !reason.trim()} onClick={bulkDeny}>
                {busy ? "Sending…" : `Send to ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
