// EnvBanner — orange "STAGING" stripe at top of every page when the
// deployment isn't production. Driven by NEXT_PUBLIC_ENV env var.
//   - production → renders nothing
//   - staging / preview / development → shows the banner

export function EnvBanner() {
  const env = process.env.NEXT_PUBLIC_ENV;
  if (!env || env === "production") return null;

  const label = env === "staging" ? "STAGING"
              : env === "preview"  ? "PREVIEW"
              :                      env.toUpperCase();

  return (
    <div
      role="status"
      aria-label="Non-production environment"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        width: "100%",
        background: "linear-gradient(90deg, #e8793a, #c45f20)",
        color: "#fff",
        textAlign: "center",
        padding: "0.4rem 1rem",
        fontFamily: "var(--font-body)",
        fontSize: "0.78rem",
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
      }}
    >
      {label} · this is a test site · nothing here is real
    </div>
  );
}
