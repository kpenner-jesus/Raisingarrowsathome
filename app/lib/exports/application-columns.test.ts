import { describe, it, expect } from "vitest";
import { childrenSummary, childrenCount, answerColumns, answerValue } from "./application-columns";

const CFG = [
  { key: "whyHomeschool",  question: "Why do you want to homeschool?" },
  { key: "biggestConcern", question: "What is your biggest concern?" },
  { key: "howGrantHelps",  question: "How would this grant help?" },
];

describe("childrenSummary", () => {
  it("reads as a sentence", () => {
    expect(childrenSummary([{ age: 8, grade: "Grade 3" }, { age: 10, grade: "Grade 5" }]))
      .toBe("8 (Grade 3), 10 (Grade 5)");
  });
  it("copes with a missing grade or age", () => {
    expect(childrenSummary([{ age: 8 }, { grade: "Grade 5" }])).toBe("8, Grade 5");
  });
  it("returns empty for a missing or malformed column", () => {
    expect(childrenSummary(null)).toBe("");
    expect(childrenSummary("nope")).toBe("");
    expect(childrenSummary([])).toBe("");
  });
  it("counts independently of the summary", () => {
    expect(childrenCount([{ age: 1 }, { age: 2 }])).toBe(2);
    expect(childrenCount(null)).toBe(0);
  });
});

describe("answerColumns", () => {
  it("puts known keys in CONFIG order, not alphabetical", () => {
    const rows = [{ answers: { howGrantHelps: "a", whyHomeschool: "b", biggestConcern: "c" } }];
    expect(answerColumns(rows, CFG).columns.map((c) => c.key))
      .toEqual(["whyHomeschool", "biggestConcern", "howGrantHelps"]);
  });

  it("only includes keys that actually appear", () => {
    const rows = [{ answers: { whyHomeschool: "b" } }];
    expect(answerColumns(rows, CFG).columns.map((c) => c.key)).toEqual(["whyHomeschool"]);
  });

  it("unions keys across rows, so a sparse row doesn't drop a column", () => {
    const rows = [{ answers: { whyHomeschool: "a" } }, { answers: { howGrantHelps: "b" } }];
    expect(answerColumns(rows, CFG).columns.map((c) => c.key))
      .toEqual(["whyHomeschool", "howGrantHelps"]);
  });

  it("keeps legacy keys the current config has never heard of", () => {
    const rows = [{ answers: { whyHomeschool: "a", priorExperience: "x", zzOld: "y" } }];
    const cols = answerColumns(rows, CFG).columns;
    expect(cols.map((c) => c.key)).toEqual(["whyHomeschool", "priorExperience", "zzOld"]);
    expect(cols[1].header).toBe("answers.priorExperience");
  });

  it("numbers known headers so identical question text still yields unique columns", () => {
    const dupe = [
      { key: "a", question: "Tell us more" },
      { key: "b", question: "Tell us more" },
    ];
    const cols = answerColumns([{ answers: { a: "1", b: "2" } }], dupe).columns;
    expect(cols.map((c) => c.header)).toEqual(["Q1. Tell us more", "Q2. Tell us more"]);
    expect(new Set(cols.map((c) => c.header)).size).toBe(2);
  });

  it("caps the column count and reports how many were dropped", () => {
    const answers = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "v"]));
    const { columns, truncated } = answerColumns([{ answers }], CFG, 40);
    expect(columns).toHaveLength(40);
    expect(truncated).toBe(10);
  });

  it("handles rows with no answers at all", () => {
    expect(answerColumns([{}, { answers: null }], CFG).columns).toEqual([]);
  });
});

describe("answerValue", () => {
  it("reads a present string", () => {
    expect(answerValue({ a: "hi" }, "a")).toBe("hi");
  });
  it("returns empty for a missing key rather than 'undefined'", () => {
    expect(answerValue({ a: "hi" }, "b")).toBe("");
    expect(answerValue(null, "b")).toBe("");
  });
  it("serialises a non-string value instead of dropping it", () => {
    expect(answerValue({ a: { nested: 1 } }, "a")).toBe('{"nested":1}');
    expect(answerValue({ a: 42 }, "a")).toBe("42");
  });
});
