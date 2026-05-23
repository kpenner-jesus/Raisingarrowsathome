"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, icon }: { href: string; label: string; icon?: string }) {
  const pathname = usePathname();
  const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      style={{
        display: "flex", alignItems: "center", gap: "0.625rem",
        padding: "0.55rem 0.85rem", borderRadius: 8,
        fontFamily: "var(--font-body)", fontSize: "0.92rem", fontWeight: 500,
        textDecoration: "none",
        color: active ? "#fff" : "rgba(255,255,255,0.78)",
        background: active ? "rgba(232,121,58,0.3)" : "transparent",
        borderLeft: active ? "2px solid var(--ra-accent)" : "2px solid transparent",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {icon && <span style={{ fontSize: "0.95rem", opacity: 0.9 }}>{icon}</span>}
      {label}
    </Link>
  );
}
