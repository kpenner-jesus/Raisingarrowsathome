// Tiny HMAC helpers for signing self-contained tokens (withdraw,
// unsubscribe) that don't need a DB lookup.
import { createHmac, timingSafeEqual } from "crypto";

function secret(): Buffer {
  const s = process.env.APP_HMAC_SECRET || process.env.CRON_SECRET || "";
  if (!s) throw new Error("APP_HMAC_SECRET or CRON_SECRET must be set");
  return Buffer.from(s);
}

/** Sign payload+expiry as `${payload}.${expiry}.${sig}` (b64url). */
export function signToken(payload: string, ttlSeconds: number): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret()).update(`${payload}.${expiry}`).digest("base64url");
  return `${payload}.${expiry}.${sig}`;
}

export function verifyToken(token: string): { ok: true; payload: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [payload, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return { ok: false, reason: "expiry invalid" };
  if (Math.floor(Date.now() / 1000) > expiry) return { ok: false, reason: "expired" };
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
