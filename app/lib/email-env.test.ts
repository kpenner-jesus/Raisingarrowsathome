import { describe, it, expect, afterEach } from "vitest";
import {
  emailEnv, envTags, eventEnv, shouldRecordEvent, ENV_TAG_NAME,
  routeRecipients, routedSubject, routedNotice,
} from "./email-env";

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

describe("routeRecipients — keeping practice mail off real families", () => {
  const FAMILY = "realfamily@gmail.com";
  const TESTER = "tester@charity.org";

  it("production delivers to the real recipient, untouched", () => {
    const r = routeRecipients(FAMILY, { env: "production", redirectTo: TESTER });
    expect(r).toEqual({ send: true, to: [FAMILY], redirectedFrom: null });
  });

  it("staging delivers to the tester instead of the family", () => {
    const r = routeRecipients(FAMILY, { env: "preview", redirectTo: TESTER });
    expect(r.send).toBe(true);
    if (!r.send) throw new Error("unreachable");
    expect(r.to).toEqual([TESTER]);
    expect(r.redirectedFrom).toEqual([FAMILY]);
  });

  it("staging sends NOTHING when no tester inbox is configured", () => {
    // The alternative is mailing a real family from the charity's own domain
    // for a practice action. Sending nothing is the safe failure.
    const r = routeRecipients(FAMILY, { env: "preview", redirectTo: "" });
    expect(r.send).toBe(false);
    if (r.send) throw new Error("unreachable");
    expect(r.wouldHaveGoneTo).toEqual([FAMILY]);
  });

  it("collapses a multi-recipient send onto the one tester", () => {
    const r = routeRecipients(["a@x.com", "b@y.com"], { env: "preview", redirectTo: TESTER });
    if (!r.send) throw new Error("unreachable");
    expect(r.to).toEqual([TESTER]);
    expect(r.redirectedFrom).toEqual(["a@x.com", "b@y.com"]);
  });

  it("local development is treated like staging, not like production", () => {
    expect(routeRecipients(FAMILY, { env: "development", redirectTo: "" }).send).toBe(false);
  });

  it("labels the subject with who it was really for", () => {
    const r = routeRecipients(FAMILY, { env: "preview", redirectTo: TESTER });
    expect(routedSubject("Your grant is approved", r)).toContain(FAMILY);
    expect(routedSubject("Your grant is approved", r)).toContain("Your grant is approved");
  });

  it("does NOT relabel a production subject", () => {
    const r = routeRecipients(FAMILY, { env: "production", redirectTo: TESTER });
    expect(routedSubject("Your grant is approved", r)).toBe("Your grant is approved");
    expect(routedNotice(r)).toBe("");
  });

  it("explains itself in the body of a redirected message", () => {
    const r = routeRecipients(FAMILY, { env: "preview", redirectTo: TESTER });
    const notice = routedNotice(r);
    expect(notice).toContain(FAMILY);
    expect(notice).toMatch(/practice/i);
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
