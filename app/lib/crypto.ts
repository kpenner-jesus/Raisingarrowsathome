// ============================================================
//  crypto.ts — app-layer encryption for tenant-supplied secrets
//
//  Used to store third-party API keys (e.g. a tenant's OpenRouter key)
//  encrypted at rest, so a DB dump alone never exposes a customer's key.
//  AES-256-GCM with a 32-byte key derived (sha256) from the platform
//  secret AI_KEY_ENCRYPTION_SECRET. Ciphertext format: "v1:" + base64(iv|tag|ct).
//
//  The secret must be set in the deploy env (Vercel) for prod + staging.
//  Generate one with:  openssl rand -hex 32
//  When unset, encrypt throws and decrypt returns null — callers treat a
//  tenant as "no key configured" and fall back to the platform model.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function keyFromEnv(): Buffer | null {
  const s = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!s) return null;
  return createHash("sha256").update(s).digest(); // 32 bytes regardless of input length
}

/** True when the platform encryption secret is configured. */
export function secretsReady(): boolean {
  return keyFromEnv() !== null;
}

/** Encrypt a plaintext secret. Throws when AI_KEY_ENCRYPTION_SECRET is unset. */
export function encryptSecret(plaintext: string): string {
  const key = keyFromEnv();
  if (!key) throw new Error("AI_KEY_ENCRYPTION_SECRET is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a "v1:" blob. Returns null on any failure (unset secret, tamper,
 *  wrong key, malformed input) so callers can degrade to the platform model. */
export function decryptSecret(blob: string | null | undefined): string | null {
  const key = keyFromEnv();
  if (!key || !blob || !blob.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(blob.slice(3), "base64");
    const iv  = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct  = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Mask a secret for display (e.g. "sk-or-…last4"). Never returns the full value. */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return "";
  const last4 = plaintext.slice(-4);
  return `••••••••${last4}`;
}
