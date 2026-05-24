// Reusable column-header link that toggles ?sort=col&dir=asc/desc on click.
// Pure Link, no client JS needed (server re-renders).
import Link from "next/link";

export function SortHeader({
  label, col, currentSort, currentDir, basePath, extraParams = {},
  align = "left",
}: {
  label: string;
  col: string;
  currentSort?: string;
  currentDir?: "asc" | "desc";
  basePath: string;
  extraParams?: Record<string, string | undefined>;
  align?: "left" | "right" | "center";
}) {
  const isActive = currentSort === col;
  const nextDir: "asc" | "desc" =
    isActive ? (currentDir === "asc" ? "desc" : "asc") : "asc";

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  params.set("sort", col);
  params.set("dir", nextDir);

  const arrow = isActive ? (currentDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <th style={{ textAlign: align }}>
      <Link
        href={`${basePath}?${params.toString()}`}
        style={{
          color: "inherit",
          textDecoration: "none",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.2rem",
          cursor: "pointer",
          opacity: isActive ? 1 : 0.85,
        }}
        title={`Sort by ${label} (${nextDir})`}
      >
        {label}{arrow}
      </Link>
    </th>
  );
}
