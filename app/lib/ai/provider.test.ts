import { describe, it, expect } from "vitest";
import { toOpenAITools, toOpenAIMessages, fromOpenAI } from "./provider";

describe("toOpenAITools", () => {
  it("maps anthropic tool defs to openai function tools", () => {
    const r = toOpenAITools([{ name: "x", description: "d", input_schema: { type: "object", properties: {} } } as any]);
    expect(r).toEqual([{ type: "function", function: { name: "x", description: "d", parameters: { type: "object", properties: {} } } }]);
  });
  it("returns undefined for no tools", () => {
    expect(toOpenAITools([])).toBeUndefined();
    expect(toOpenAITools(undefined)).toBeUndefined();
  });
});

describe("toOpenAIMessages", () => {
  it("prepends system + passes string user content", () => {
    const r = toOpenAIMessages("sys", [{ role: "user", content: "hi" }] as any);
    expect(r).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
  });
  it("translates user text + image into OpenAI content parts", () => {
    const r = toOpenAIMessages("", [{ role: "user", content: [
      { type: "text", text: "see" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } },
    ] }] as any);
    expect(r).toEqual([{ role: "user", content: [
      { type: "text", text: "see" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
    ] }]);
  });
  it("translates assistant tool_use into tool_calls", () => {
    const r = toOpenAIMessages("", [{ role: "assistant", content: [
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t1", name: "foo", input: { a: 1 } },
    ] }] as any);
    expect(r).toEqual([{ role: "assistant", content: "ok", tool_calls: [
      { id: "t1", type: "function", function: { name: "foo", arguments: JSON.stringify({ a: 1 }) } },
    ] }]);
  });
  it("translates tool_result blocks into tool-role messages", () => {
    const r = toOpenAIMessages("", [{ role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: "result" },
    ] }] as any);
    expect(r).toEqual([{ role: "tool", tool_call_id: "t1", content: "result" }]);
  });
});

describe("fromOpenAI", () => {
  it("text only → one text block", () => {
    expect(fromOpenAI({ content: "hello" })).toEqual([{ type: "text", text: "hello" }]);
  });
  it("tool_calls → tool_use blocks with parsed input", () => {
    expect(fromOpenAI({ content: "", tool_calls: [{ id: "t1", function: { name: "foo", arguments: '{"a":1}' } }] }))
      .toEqual([{ type: "tool_use", id: "t1", name: "foo", input: { a: 1 } }]);
  });
  it("empty message → single empty text block (loop reads it as final)", () => {
    expect(fromOpenAI({ content: null })).toEqual([{ type: "text", text: "" }]);
  });
  it("malformed tool args → empty input object, not a throw", () => {
    expect(fromOpenAI({ tool_calls: [{ id: "t", function: { name: "f", arguments: "{bad" } }] }))
      .toEqual([{ type: "tool_use", id: "t", name: "f", input: {} }]);
  });
  it("extracts text from array-of-parts content (some models return this)", () => {
    expect(fromOpenAI({ content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] }))
      .toEqual([{ type: "text", text: "hello world" }]);
  });
  it("skips tool_calls missing id or name (never emits undefined fields)", () => {
    expect(fromOpenAI({ content: "", tool_calls: [
      { function: { name: "f", arguments: "{}" } }, // no id
      { id: "x", function: { arguments: "{}" } },    // no name
    ] })).toEqual([{ type: "text", text: "" }]);
  });
});
