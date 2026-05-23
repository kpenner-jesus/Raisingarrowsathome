// Initials avatar (e.g. "Jordan & Tierza Penner" → "JP").
// Picks first letter of first two whitespace-separated tokens, ignoring "&" + "and".

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const tokens = (name || "?")
    .replace(/&/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.toLowerCase() !== "and");
  const initials =
    (tokens[0]?.[0] ?? "?") + (tokens[1]?.[0] ?? "");
  return (
    <span
      className="ra-avatar"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials.toUpperCase()}
    </span>
  );
}

export function AvatarRow({ name, secondary }: { name: string; secondary?: string }) {
  return (
    <span className="ra-avatar-row">
      <Avatar name={name} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
        <span style={{ fontWeight: 500, color: "var(--ra-ink)" }}>{name}</span>
        {secondary && <span className="ra-tiny">{secondary}</span>}
      </span>
    </span>
  );
}
