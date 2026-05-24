"use client";

/* MobileNav primitives — used by both portal and admin layouts.
 *  - <MobileTabBar items={...} /> — fixed bottom nav (mobile only via CSS)
 *  - <MobileAppBar brand="..." onMenuClick={...} /> — sticky top bar
 *  - <MobileDrawer open onClose items={...} /> — slide-in right nav
 *
 * Active-tab detection uses next/navigation usePathname so the
 * highlighted tab updates on every route change without a refresh.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type TabItem = {
  href: string;
  label: string;
  /** Inline SVG paths (no fill, stroke-width set on parent <svg>) */
  icon: React.ReactNode;
  /** If true, treats this as the "More" tab that triggers the drawer */
  isMore?: boolean;
};

type DrawerItem = {
  href: string;
  label: string;
  /** Short text glyph rendered in monospace */
  glyph?: string;
};

/* ───────── shared icons (24x24, stroke=currentColor 2) ───────── */
export const Icons = {
  home: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12l9-9 9 9M5 10v10h14V10" />
    </svg>
  ),
  doc: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 5h6M9 9h6M9 13h4M5 3h14v18H5z" />
    </svg>
  ),
  photos: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  help: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17h.01" />
    </svg>
  ),
  users: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="8" r="4" /><path d="M2 21c0-3.5 3.5-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="9" r="3" /><path d="M22 20c0-2.6-2-4.6-5-4.6" />
    </svg>
  ),
  cash: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9v6M18 9v6" />
    </svg>
  ),
  apps: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 4h10l3 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V9l3-5z" />
      <path d="M4 9h16M9 13l2 2 4-4" />
    </svg>
  ),
  more: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  upload: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 20V8M6 14l6-6 6 6M4 4h16" />
    </svg>
  ),
  user: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  ),
  close: (
    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 6l12 12M6 18L18 6" />
    </svg>
  ),
};

/* ─────────── MobileTabBar ─────────── */
export function MobileTabBar({
  items,
  onMoreClick,
}: {
  items: TabItem[];
  onMoreClick?: () => void;
}) {
  const pathname = usePathname() || "";
  return (
    <nav className="ra-tabbar" style={{ ["--tab-count" as any]: String(items.length) }} aria-label="Main">
      {items.map((it) => {
        const active = it.isMore ? false : (it.href === "/portal" || it.href === "/admin"
          ? pathname === it.href
          : pathname.startsWith(it.href));
        if (it.isMore && onMoreClick) {
          return (
            <button
              key={it.label}
              type="button"
              onClick={onMoreClick}
              className={active ? "is-active" : ""}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                font: "inherit", color: "inherit",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                padding: "0.25rem 0", fontSize: "0.7rem", fontWeight: 500,
                minHeight: 48, justifyContent: "center",
              }}
            >
              <span style={{ width: 24, height: 24, display: "inline-block" }}>{it.icon}</span>
              {it.label}
            </button>
          );
        }
        return (
          <Link key={it.href} href={it.href} className={active ? "is-active" : ""}>
            <span style={{ width: 24, height: 24, display: "inline-block" }}>{it.icon}</span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ─────────── MobileAppBar ─────────── */
export function MobileAppBar({
  brand = "Raising Arrows",
  brandHref = "/",
  rightIcon,
  onRightClick,
  rightAriaLabel = "Menu",
}: {
  brand?: string;
  brandHref?: string;
  rightIcon?: React.ReactNode;
  onRightClick?: () => void;
  rightAriaLabel?: string;
}) {
  return (
    <header className="ra-appbar">
      <Link href={brandHref} className="ra-appbar-brand">{brand}</Link>
      <button
        type="button"
        className="ra-appbar-icon"
        aria-label={rightAriaLabel}
        onClick={onRightClick}
      >
        {rightIcon ?? Icons.more}
      </button>
    </header>
  );
}

/* ─────────── MobileDrawer (slide-in right nav) ─────────── */
export function MobileDrawer({
  open,
  onClose,
  title = "Menu",
  items,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: DrawerItem[];
  footer?: React.ReactNode;
}) {
  const pathname = usePathname() || "";

  // Close on ESC + lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Close on route change
  useEffect(() => { if (open) onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`ra-drawer-backdrop${open ? " is-open" : ""}`} onClick={onClose} aria-hidden={!open} />
      <aside className={`ra-drawer${open ? " is-open" : ""}`} aria-hidden={!open} role="dialog">
        <div className="ra-drawer-head">
          <span className="ra-drawer-head-name">{title}</span>
          <button type="button" className="ra-appbar-icon" aria-label="Close menu" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <nav className="ra-drawer-nav">
          {items.map((it) => {
            const active = it.href === "/portal" || it.href === "/admin"
              ? pathname === it.href
              : pathname.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} className={active ? "is-active" : ""}>
                {it.glyph && <span className="ic">{it.glyph}</span>}
                <span>{it.label}</span>
              </Link>
            );
          })}
        </nav>
        {footer && <div className="ra-drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

/* ─────────── Convenience: stateful Drawer button bundle ─────────── */
export function MobileNavShell({
  brand = "Raising Arrows",
  drawerTitle = "Menu",
  drawerItems,
  drawerFooter,
  tabItems,
}: {
  brand?: string;
  drawerTitle?: string;
  drawerItems: DrawerItem[];
  drawerFooter?: React.ReactNode;
  tabItems: TabItem[];
}) {
  const [open, setOpen] = useState(false);
  const tabsWithMore = tabItems.some((t) => t.isMore)
    ? tabItems
    : [...tabItems, { href: "#more", label: "More", icon: Icons.more, isMore: true }];
  return (
    <>
      <MobileAppBar brand={brand} onRightClick={() => setOpen(true)} />
      <MobileDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={drawerTitle}
        items={drawerItems}
        footer={drawerFooter}
      />
      <MobileTabBar items={tabsWithMore} onMoreClick={() => setOpen(true)} />
    </>
  );
}
