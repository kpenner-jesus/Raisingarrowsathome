"use client";
// Small client wrapper so the drawer footer can submit a POST form for sign-out
// without needing a server component nested inside the (client) MobileDrawer.

export function PortalLogoutLink() {
  return (
    <form action="/auth/logout" method="post" style={{ marginTop: "0.6rem" }}>
      <button
        type="submit"
        className="ra-btn"
        style={{
          width: "100%",
          background: "transparent",
          border: "1px solid rgba(0,0,0,0.15)",
          fontWeight: 500,
        }}
      >
        Sign out
      </button>
    </form>
  );
}
