import { describe, it, expect, afterEach } from "vitest";
import { emailEnv, envTags, eventEnv, shouldRecordEvent, ENV_TAG_NAME } from "./email-env";

const ORIGINAL = process.env.VERCEL_ENV;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL;
});

describe("emailEnv", () => {
  it("reports the platform environment", () => {
    process.env.VERCEL_ENV = "production";
    expect(emailEnv()).toBe("production");
    process.env.VERCEL_ENV = "preview";
    expect(emailEnv()).toBe("preview");
  });

  it("falls back to development when unset (local dev)", () => {
    delete process.env.VERCEL_ENV;
    expect(emailEnv()).toBe("development");
  });

  it("never emits a value Resend would reject", () => {
    // Tag values allow ONLY ASCII letters, numbers, _ and -. A rejected tag
    // fails the SEND, which is far worse than the leak we're closing.
    for (const bad of ["feature/my-branch", "a b", "prod.1", "héllo", ""]) {
      process.env.VERCEL_ENV = bad;
      expect(emailEnv(), bad).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("envTags", () => {
  it("produces the ARRAY shape the send API wants", () => {
    process.env.VERCEL_ENV = "production";
    expect(envTags()).toEqual([{ name: "env", value: "production" }]);
  });
});

describe("eventEnv — the asymmetry", () => {
  it("reads the OBJECT shape the webhook actually sends", () => {
    // This is the trap: we send an array, Resend echoes an object keyed by
    // tag name. Reading it as an array returns undefined on every real event,
    // which reads as "untagged" — so nothing is dropped and the fix silently
    // does nothing at all.
    expect(eventEnv({ tags: { env: "preview" } })).toBe("preview");
  });

  it("also tolerates the array shape, in case Resend changes back", () => {
    expect(eventEnv({ tags: [{ name: ENV_TAG_NAME, value: "production" }] })).toBe("production");
  });

  it("returns null when there is no marker", () => {
    expect(eventEnv({})).toBeNull();
    expect(eventEnv({ tags: null })).toBeNull();
    expect(eventEnv({ tags: {} })).toBeNull();
    expect(eventEnv({ tags: [] })).toBeNull();
    expect(eventEnv({ tags: { other: "x" } })).toBeNull();
    expect(eventEnv(undefined)).toBeNull();
  });

  it("ignores a non-string or empty value", () => {
    expect(eventEnv({ tags: { env: "" } })).toBeNull();
    expect(eventEnv({ tags: { env: 7 } })).toBeNull();
  });
});

describe("shouldRecordEvent", () => {
  it("records this environment's own events", () => {
    expect(shouldRecordEvent({ tags: { env: "production" } }, "production"))
      .toEqual({ record: true, reason: "own-environment" });
  });

  it("DROPS an event from another environment — the actual fix", () => {
    // A staging email arriving at the production webhook.
    expect(shouldRecordEvent({ tags: { env: "preview" } }, "production"))
      .toEqual({ record: false, reason: "foreign-environment", from: "preview" });
  });

  it("drops production events arriving at a staging webhook too (symmetric)", () => {
    expect(shouldRecordEvent({ tags: { env: "production" } }, "preview"))
      .toEqual({ record: false, reason: "foreign-environment", from: "production" });
  });

  it("KEEPS untagged events rather than deleting real history", () => {
    // Mail already in flight when this ships, and any send path we missed,
    // arrives with no marker. Dropping those would lose genuine production
    // history to fix a pollution problem — a strictly worse trade.
    expect(shouldRecordEvent({}, "production"))
      .toEqual({ record: true, reason: "untagged" });
    expect(shouldRecordEvent({ subject: "hi", to: ["a@b.com"] }, "production"))
      .toEqual({ record: true, reason: "untagged" });
  });

  it("keeps local-dev events on a local webhook", () => {
    expect(shouldRecordEvent({ tags: { env: "development" } }, "development").record).toBe(true);
  });
});
