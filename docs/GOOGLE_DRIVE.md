# Attach from Google Drive

Adds a **From Google Drive** option to the attach (📎) button in the admin
chat. The admin picks a file out of their own Drive; it lands in the chat
exactly as a locally-chosen file does.

Entirely optional. With the three env vars unset, 📎 opens the local file
picker directly and nothing about the chat changes.

## How it works

1. Google Identity Services issues a **short-lived access token** in the
   browser.
2. Google's own **Picker** UI shows the admin their Drive.
3. The browser downloads the one picked file **straight from Google**.
4. It becomes an ordinary `File` and goes through `AdminChat.attachFile()` —
   the same path a local file takes. Photos compress, PDFs go as document
   blocks, spreadsheets parse to text. No second set of rules.

Code: `app/lib/ai/google-drive.ts` (client-side only).

## Why this design

- **Scope is `drive.file`, not `drive.readonly`.** That grants per-file access
  to files the admin explicitly picks. It keeps the app out of Google's
  restricted-scope review (annual third-party security assessment — thousands
  of dollars, weeks of delay), and a mis-click can't expose an unrelated
  document.
- **No server-side Google credential.** The token lives in the browser tab and
  is never persisted or sent to our API. There is nothing to leak, nothing to
  rotate, and nothing to clean up when an admin leaves. This is also why a
  background "watched folder" sync is NOT built — that needs a stored refresh
  token plus the restricted scope above.
- Google-native files can't be downloaded raw, so they're **exported** into a
  format the chat already reads: Sheet → `.xlsx` (every tab survives), Doc →
  `.txt`, Slides/Drawing → PDF.

## Setup (about five minutes)

1. **Google Cloud Console** → create a project (or reuse one).
2. **APIs & Services → Library** → enable **Google Picker API** and
   **Google Drive API**.
3. **OAuth consent screen** → External, fill in app name + support email.
   Add the scope `.../auth/drive.file`. It is a *non-sensitive* scope, so no
   verification submission is needed. Add admin emails as test users while the
   app is in Testing, or hit **Publish** to lift the test-user list.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised JavaScript origins:
   - `https://raisingarrowsathome.com`
   - `https://staging.raisingarrowsathome.com`
   - `http://localhost:3000`
   Copy the client ID → `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
5. **Credentials → Create credentials → API key.** Restrict it:
   *Application restrictions* → HTTP referrers → the same hosts.
   *API restrictions* → Google Picker API. Copy → `NEXT_PUBLIC_GOOGLE_API_KEY`.
6. **Project number** (Cloud Console home, not the project *id*) →
   `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`. Required: it ties a `drive.file` grant
   to this project, and without it the picked file can't be read back.
7. Add all three to Vercel (Production + Preview) and redeploy.

## Notes

- First pick shows a one-time Google consent: *"…wants to open files you
  select from Google Drive."* Approve once per browser.
- Pop-up blockers: Google's window is a pop-up. The UI reports this
  specifically rather than hanging.
- Files over 20 MB are refused before download (`MAX_DRIVE_BYTES`); the chat's
  own per-type caps still apply afterwards.
- Admin chat only. The family portal chat has no attachments and no tools.
