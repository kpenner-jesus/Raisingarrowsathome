// Status badge used across admin list/detail pages.
// Class names: ra-badge ra-badge-<status>  (defined in admin.css)

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`ra-badge ra-badge-${status}`}>
      <span className="ra-badge-dot" />
      {status}
    </span>
  );
}
