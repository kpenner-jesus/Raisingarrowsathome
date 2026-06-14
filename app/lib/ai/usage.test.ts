import { describe, it, expect, afterEach } from "vitest";
import { dailyCap } from "./usage";

const ORIG = process.env.AI_CHAT_DAILY_CAP;
afterEach(() => {
  if (ORIG === undefined) delete process.env.AI_CHAT_DAILY_CAP;
  else process.env.AI_CHAT_DAILY_CAP = ORIG;
});

describe("dailyCap", () => {
  it("defaults to 200 when unset", () => {
    delete process.env.AI_CHAT_DAILY_CAP;
    expect(dailyCap()).toBe(200);
  });
  it("reads a positive override", () => {
    process.env.AI_CHAT_DAILY_CAP = "50";
    expect(dailyCap()).toBe(50);
  });
  it("floors a fractional override", () => {
    process.env.AI_CHAT_DAILY_CAP = "12.9";
    expect(dailyCap()).toBe(12);
  });
  it("ignores junk / non-positive and falls back to 200", () => {
    process.env.AI_CHAT_DAILY_CAP = "abc";
    expect(dailyCap()).toBe(200);
    process.env.AI_CHAT_DAILY_CAP = "0";
    expect(dailyCap()).toBe(200);
    process.env.AI_CHAT_DAILY_CAP = "-5";
    expect(dailyCap()).toBe(200);
  });
});
