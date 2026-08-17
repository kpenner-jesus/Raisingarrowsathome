// Tiny HMAC helpers for signing self-contained tokens (withdraw,
// unsubscribe) that don't need a DB lookup.
import { createHmac, timingSafeEqual } from "crypto";

function secret(): Buffer {
  const s = process.env.APP_HMAC_SECRET || process.env.CRON_SECRET || "";
  if (!s) throw new Error("APP_HMAC_SECRET or CRON_SECRET must be set");
  return Buffer.from(s);
}

/** Sign payload+expiry as `${b64payload}.${expiry}.${sig}`.
 *
 *  Payload is base64url-encoded so we can split safely on '.' even
 *  when the payload itself contains '.' (e.g. `unsub:user@gmail.com`).
 *  Signature is computed over the RAW (decoded) payload + expiry. */
export function signToken(payload: string, ttlSeconds: number): string {
  return signTokenWithExpiry(payload, Math.floor(Date.now() / 1000) + ttlSeconds);
}

/**
 * Same, but with an ABSOLUTE expiry instead of a TTL — so the same inputs
 * always produce the same token.
 *
 * Broadcasts need this. A retried send must render byte-identical html, or the
 * provider's idempotency key is handed a changed payload and rejects it
 * instead of deduping — which would turn a safe retry into a second email.
 * Deriving the expiry from the broadcast's created_at makes the token stable.
 */
export function signTokenWithExpiry(payload: string, expiryUnixSeconds: number): string {
  const expiry = Math.floor(expiryUnixSeconds);
  const b64    = Buffer.from(payload, "utf8").toString("base64url");
  const sig    = createHmac("sha256", secret()).update(`${payload}.${expiry}`).digest("base64url");
  return `${b64}.${expiry}.${sig}`;
}

export function verifyToken(token: string): { ok: true; payload: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [b64, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return { ok: false, reason: "expiry invalid" };
  if (Math.floor(Date.now() / 1000) > expiry) return { ok: false, reason: "expired" };

  let payload: string;
  try { payload = Buffer.from(b64, "base64url").toString("utf8"); }
  catch { return { ok: false, reason: "payload decode" }; }
  if (!payload) return { ok: false, reason: "payload empty" };

  const expected = createHmac("sha256", secret()).update(`${payload}.${expiry}`).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, reason: "sig length" };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "sig mismatch" };
  } catch {
    return { ok: false, reason: "sig decode" };
  }
  return { ok: true, payload };
}
