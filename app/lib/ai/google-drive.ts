// ============================================================
//  google-drive.ts — "attach from Google Drive" for the admin chat.
//
//  Runs ENTIRELY in the browser. The flow is:
//    1. Google Identity Services hands us a short-lived access token.
//    2. Google's own Picker UI shows the admin their Drive.
//    3. We download the ONE file they picked, straight from Google.
//    4. It becomes a normal File and goes through the same attachment
//       path as a locally-chosen file (see AdminChat.attachFile).
//
//  Two deliberate properties:
//
//  - Scope is `drive.file`, which grants per-file access to files the user
//    explicitly picks — NOT their whole Drive. That keeps us out of Google's
//    restricted-scope review (annual third-party security assessment), and
//    means a mis-click can't expose an unrelated document.
//  - The access token never leaves the browser and is never persisted. Our
//    server has no Google credential to leak, and there is nothing to revoke
//    if a tenant admin leaves.
//
//  Google-native files (Sheets/Docs/Slides) have no bytes to download, so
//  they're EXPORTED to a format we already read — a Sheet becomes .xlsx and
//  flows into the existing spreadsheet parser.
// ============================================================

/** Per-file access to what the user picks. Deliberately NOT drive.readonly. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GSI_SRC    = "https://accounts.google.com/gsi/client";
const GAPI_SRC   = "https://apis.google.com/js/api.js";
const XLSX_MIME  = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Refuse before downloading — the chat caps attachments well below this. */
export const MAX_DRIVE_BYTES = 20 * 1024 * 1024;

export interface DriveConfig {
  clientId: string;
  apiKey:   string;
  appId:    string;
  ready:    boolean;
}

/**
 * Read the public Google config. These must be referenced statically for
 * Next to inline them at build time, so they can't be looped over.
 * `ready` false → the UI hides the Drive option entirely, mirroring how
 * Stripe/Resend hide themselves when unconfigured.
 */
export function driveConfig(): DriveConfig {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID  || "";
  const apiKey   = process.env.NEXT_PUBLIC_GOOGLE_API_KEY    || "";
  const appId    = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER || "";
  return { clientId, apiKey, appId, ready: Boolean(clientId && apiKey) };
}

// ── Pure helpers (unit-tested) ───────────────────────────────

export interface ExportSpec { mime: string; ext: string }

/**
 * Google-native docs can't be downloaded raw — they must be exported.
 * Sheets → .xlsx (keeps every tab; our parser reads multi-sheet workbooks).
 * Docs → .txt. Slides/Drawings → PDF, which the chat now reads natively.
 * Returns null for ordinary uploaded files, which download as-is.
 */
export function exportSpec(mimeType: string): ExportSpec | null {
  switch (mimeType) {
    case "application/vnd.google-apps.spreadsheet":  return { mime: XLSX_MIME,         ext: "xlsx" };
    case "application/vnd.google-apps.document":     return { mime: "text/plain",      ext: "txt"  };
    case "application/vnd.google-apps.presentation": return { mime: "application/pdf", ext: "pdf"  };
    case "application/vnd.google-apps.drawing":      return { mime: "application/pdf", ext: "pdf"  };
    default: return null;
  }
}

/**
 * Google-native files have no extension in their name ("Grantees 2026"), but
 * the attachment pipeline decides how to read a file partly from its
 * extension — so give the exported copy the right one.
 */
export function driveFileName(name: string, ext: string | null): string {
  const base = (name || "file").trim() || "file";
  if (!ext) return base;
  return base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? base : `${base}.${ext}`;
}

/** Drive API URL for a pick: export for native docs, raw bytes otherwise. */
export function downloadUrl(fileId: string, spec: ExportSpec | null): string {
  const id = encodeURIComponent(fileId);
  return spec
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(spec.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
}

// ── Browser plumbing ─────────────────────────────────────────

const loaded = new Map<string, Promise<void>>();

/** Load a third-party script once, reusing the in-flight promise. */
function loadScript(src: string): Promise<void> {
  const cached = loaded.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { loaded.delete(src); reject(new Error("Couldn't reach Google. Check your connection and try again.")); };
    document.head.appendChild(el);
  });
  loaded.set(src, p);
  return p;
}

/** Prompt for (or silently refresh) a Drive access token. */
async function getAccessToken(clientId: string): Promise<string> {
  await loadScript(GSI_SRC);
  const g = (window as any).google;
  if (!g?.accounts?.oauth2) throw new Error("Google sign-in didn't load. Try again.");

  return new Promise<string>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp?.access_token) resolve(resp.access_token);
        else reject(new Error("Google didn't grant access to Drive."));
      },
      // Fires when the popup is dismissed or blocked — without this the
      // promise would hang forever and the button would look stuck.
      error_callback: (err: any) => {
        reject(new Error(
          err?.type === "popup_failed_to_open"
            ? "Google's window was blocked — allow pop-ups for this site and try again."
            : "Google sign-in was closed.",
        ));
      },
    });
    client.requestAccessToken();
  });
}

interface DrivePick { id: string; name: string; mimeType: string; sizeBytes?: number }

/** Show Google's Picker; resolves to the chosen file, or null if cancelled. */
async function openPicker(cfg: DriveConfig, token: string): Promise<DrivePick | null> {
  await loadScript(GAPI_SRC);
  const gapi = (window as any).gapi;
  if (!gapi) throw new Error("Google's file picker didn't load. Try again.");

  await new Promise<void>((resolve, reject) =>
    gapi.load("picker", { callback: () => resolve(), onerror: () => reject(new Error("Google's file picker didn't load.")) }));

  const picker = (window as any).google.picker;
  return new Promise<DrivePick | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const builder = new picker.PickerBuilder()
      .setDeveloperKey(cfg.apiKey)
      .setOAuthToken(token)
      .addView(view)
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0] ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    // appId is what ties a drive.file grant to THIS project; without it the
    // picked file can't be read back. Optional so a misconfig still opens.
    if (cfg.appId) builder.setAppId(cfg.appId);
    builder.build().setVisible(true);
  });
}

/**
 * Full flow: token → picker → download → File.
 * Resolves null when the admin cancels (not an error). Throws with a
 * user-facing message on any real failure.
 */
export async function pickFromDrive(): Promise<File | null> {
  const cfg = driveConfig();
  if (!cfg.ready) throw new Error("Google Drive isn't set up for this site yet.");

  const token = await getAccessToken(cfg.clientId);
  const doc   = await openPicker(cfg, token);
  if (!doc) return null;

  const spec = exportSpec(doc.mimeType);
  // sizeBytes is absent for Google-native docs (nothing to size until export).
  if (!spec && Number(doc.sizeBytes) > MAX_DRIVE_BYTES) {
    throw new Error(`"${doc.name}" is too large to attach.`);
  }

  const resp = await fetch(downloadUrl(doc.id, spec), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    throw new Error(resp.status === 403
      ? `Google wouldn't let us open "${doc.name}". Make sure you picked it with the account that can see it.`
      : `Couldn't download "${doc.name}" from Drive (${resp.status}).`);
  }

  const blob = await resp.blob();
  if (blob.size > MAX_DRIVE_BYTES) throw new Error(`"${doc.name}" is too large to attach.`);

  const name = driveFileName(doc.name, spec?.ext ?? null);
  return new File([blob], name, { type: spec?.mime || doc.mimeType || blob.type });
}
