"use client";
// Sign-out button for the mobile drawer footer. Submits a POST form so the
// /auth/logout route handler can clear session cookies + redirect to "/".

export function AdminLogoutLink() {
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
