// Renders untrusted HTML (email templates, broadcast bodies) inside a sealed
// iframe instead of injecting it into the admin console page.
//
// Those bodies are written by any admin, and by the AI tools, and are viewed
// by other admins, including the owner. Injected straight into the page, a
// template containing <img onerror=...> would run script AS whoever opened
// the editor, with their session: an admin-to-owner escalation. sandbox=""
// gives the frame no scripts and no access to the page, its cookies or its API.
export function SafeHtmlPreview({ html, minHeight = 240 }: { html: string; minHeight?: number }) {
  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;line-height:1.5;color:#1a1a1a}img{max-width:100%}</style></head><body>${html}</body></html>`}
      style={{ width: "100%", minHeight, border: "none", background: "#fff" }}
    />
  );
}
