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
  const [search, setSearch] = useState(params.get("q") || "");

  // Debounce search input → URL update
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (search) next.set("q", search); else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setStatus = (s: string) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (s === "all") next.delete("status"); else next.set("status", s);
    router.replace(`${pathname}?${next.toString()}`);
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
