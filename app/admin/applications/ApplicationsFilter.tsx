"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface Props {
  totals: { all: number; pending: number; approved: number; denied: number };
}

export function ApplicationsFilter({ totals }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeStatus = params.get("status") || "all";
  const paramsQ = params.get("q") || "";
  const [search, setSearch] = useState(paramsQ);

  // Keep local input in sync if URL changes from elsewhere (back/forward, tab click).
  useEffect(() => { setSearch(paramsQ); }, [paramsQ]);

  // Debounce search input → URL update. Reads `params` fresh at flush time
  // (not the closure value at schedule time) so a status tab clicked mid-typing
  // is preserved.
  useEffect(() => {
    if (search === paramsQ) return; // nothing to push
    const t = setTimeout(() => {
      // Read latest searchParams from the URL at flush time, not from the closure.
      const fresh = new URLSearchParams(window.location.search);
      if (search) fresh.set("q", search);
      else        fresh.delete("q");
      router.replace(`${pathname}?${fresh.toString()}`);
    }, 280);
    return () => clearTimeout(t);
  }, [search, paramsQ, pathname, router]);

  const setStatus = (s: string) => {
    const fresh = new URLSearchParams(window.location.search);
    if (s === "all") fresh.delete("status"); else fresh.set("status", s);
    router.replace(`${pathname}?${fresh.toString()}`);
  };

  const tabs: { key: string; label: string; count: number }[] = [
    { key: "all",      label: "All",      count: totals.all },
    { key: "pending",  label: "Pending",  count: totals.pending },
    { key: "approved", label: "Approved", count: totals.approved },
    { key: "denied",   label: "Denied",   count: totals.denied },
  ];

  return (
    <div className="ra-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.85rem 1rem", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            style={{
              padding: "0.4rem 0.85rem", borderRadius: 100, border: "1px solid",
              cursor: "pointer", fontSize: "0.85rem", fontFamily: "var(--font-body)",
              fontWeight: 500, lineHeight: 1.3,
              background: activeStatus === t.key ? "var(--ra-ink)"      : "var(--ra-bg-soft)",
              color:      activeStatus === t.key ? "#fff"                : "var(--ra-ink-soft)",
              borderColor:activeStatus === t.key ? "var(--ra-ink)"      : "var(--ra-line-strong)",
              transition: "all 0.15s",
            }}
          >
            {t.label}{" "}
            <span style={{ opacity: 0.6, fontSize: "0.75rem", marginLeft: 4 }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, city, ref…"
        className="ra-input"
        style={{ maxWidth: 280 }}
      />
    </div>
  );
}
