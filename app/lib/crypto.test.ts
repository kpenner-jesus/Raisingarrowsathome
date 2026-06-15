import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, secretsReady, maskSecret } from "./crypto";

describe("secret encryption", () => {
  beforeAll(() => { process.env.AI_KEY_ENCRYPTION_SECRET = "test-secret-for-vitest-only"; });

  it("reports ready when the platform secret is set", () => {
    expect(secretsReady()).toBe(true);
  });

  it("round-trips and never leaks plaintext in the blob", () => {
    const plain = "sk-or-v1-abcdef0123456789";
    const blob = encryptSecret(plain);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(plain);
    expect(decryptSecret(blob)).toBe(plain);
  });

  it("returns null on tampered ciphertext (GCM auth)", () => {
    const blob = encryptSecret("another-secret-value-123");
    expect(decryptSecret(blob.slice(0, -3) + "AAA")).toBe(null);
  });

  it("returns null for non-v1 / empty input", () => {
    expect(decryptSecret("garbage")).toBe(null);
    expect(decryptSecret(null)).toBe(null);
    expect(decryptSecret(undefined)).toBe(null);
  });

  it("masks to last 4 only", () => {
    expect(maskSecret("sk-or-v1-XYZ7890")).toBe("••••••••7890");
  });
});
