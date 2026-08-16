import { describe, it, expect } from "vitest";
import {
  attachmentMediaType, findReceiptAttachment, totalAttachmentB64, maxB64For,
  stripAttachmentAt, MAX_PDF_B64, MAX_PDF_BYTES, MAX_SEND_CHARS,
  MAX_TOTAL_ATTACHMENT_B64, ATTACHMENT_LOOKBACK_USER_TURNS,
} from "./attachments";

const img = (data = "AAAA") => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
const pdf = (data = "BBBB") => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
const txt = (text = "hi") => ({ type: "text", text });
const toolResult = () => ({ type: "tool_result", tool_use_id: "t1", content: "[]" });

describe("attachmentMediaType", () => {
  it("accepts the allowed images and PDFs", () => {
    expect(attachmentMediaType(img())).toBe("image/jpeg");
    expect(attachmentMediaType(pdf())).toBe("application/pdf");
  });
  it("rejects anything else", () => {
    expect(attachmentMediaType(txt())).toBe(null);
    expect(attachmentMediaType({ type: "image", source: { type: "base64", media_type: "image/tiff", data: "x" } })).toBe(null);
    expect(attachmentMediaType({ type: "document", source: { type: "base64", media_type: "text/plain", data: "x" } })).toBe(null);
    expect(attachmentMediaType({ type: "image", source: { type: "url", url: "http://x" } })).toBe(null);
    expect(attachmentMediaType({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "" } })).toBe(null);
    expect(attachmentMediaType(null)).toBe(null);
  });
});

describe("findReceiptAttachment", () => {
  it("finds an attachment in the current message", () => {
    const msgs = [{ role: "user", content: [txt("enter this"), pdf("PDFDATA")] }];
    expect(findReceiptAttachment(msgs)).toMatchObject({ data: "PDFDATA", mediaType: "application/pdf", messageIndex: 0, blockIndex: 1 });
  });

  it("still finds it after tool plumbing and an assistant turn", () => {
    const msgs = [
      { role: "user",      content: [txt("enter this"), img("PHOTO")] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_recipients", input: {} }] },
      { role: "user",      content: [toolResult()] },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "create_receipt", input: {} }] },
    ];
    expect(findReceiptAttachment(msgs)?.data).toBe("PHOTO");
  });

  it("still finds it when the admin clarifies in a follow-up message", () => {
    const msgs = [
      { role: "user",      content: [txt("read this"), pdf("RECEIPT")] },
      { role: "assistant", content: [txt("Which family?")] },
      { role: "user",      content: [txt("the Penners")] },
    ];
    expect(findReceiptAttachment(msgs)?.data).toBe("RECEIPT");
  });

  // The reason the lookback exists at all.
  it("does NOT reach back to an unrelated PDF from earlier in the chat", () => {
    const msgs = [
      { role: "user",      content: [txt("what's in this budget?"), pdf("BUDGET")] },
      { role: "assistant", content: [txt("It shows…")] },
      { role: "user",      content: [txt("thanks")] },
      { role: "assistant", content: [txt("np")] },
      { role: "user",      content: [txt("add an $85 receipt for the Penners")] },
    ];
    expect(findReceiptAttachment(msgs)).toBe(null);
  });

  it("prefers the newest attachment when two are in range", () => {
    const msgs = [
      { role: "user", content: [pdf("OLD")] },
      { role: "user", content: [img("NEW")] },
    ];
    expect(findReceiptAttachment(msgs)?.data).toBe("NEW");
  });

  it("returns null for an empty history", () => {
    expect(findReceiptAttachment([])).toBe(null);
    expect(findReceiptAttachment([{ role: "user", content: "just text" }])).toBe(null);
  });

  it("keeps the window at the documented size", () => {
    expect(ATTACHMENT_LOOKBACK_USER_TURNS).toBe(2);
  });
});

describe("stripAttachmentAt", () => {
  it("replaces exactly the block the selector returned", () => {
    const msgs: any[] = [
      { role: "user", content: [txt("a"), pdf("KEEPME")] },
      { role: "user", content: [txt("b"), img("CONSUMED")] },
    ];
    const ref = findReceiptAttachment(msgs)!;
    stripAttachmentAt(msgs, ref);
    expect(msgs[1].content[1]).toEqual({ type: "text", text: "[receipt photo — entered]" });
    expect(msgs[0].content[1].source.data).toBe("KEEPME"); // untouched
  });

  it("labels a PDF as a PDF", () => {
    const msgs: any[] = [{ role: "user", content: [pdf("X")] }];
    stripAttachmentAt(msgs, findReceiptAttachment(msgs)!);
    expect(msgs[0].content[0].text).toContain("PDF");
  });

  it("no-ops when the block moved (never destroys the wrong one)", () => {
    const msgs: any[] = [{ role: "user", content: [pdf("X")] }];
    const ref = findReceiptAttachment(msgs)!;
    msgs[0].content = [txt("something else")];
    stripAttachmentAt(msgs, ref);
    expect(msgs[0].content[0]).toEqual(txt("something else"));
  });

  // The invariant the shared module exists to guarantee.
  it("select-then-strip always agree on the same block", () => {
    const msgs: any[] = [
      { role: "user", content: [img("A")] },
      { role: "user", content: [txt("q"), pdf("B")] },
    ];
    const ref = findReceiptAttachment(msgs)!;
    stripAttachmentAt(msgs, ref);
    // the consumed one is gone, so a re-select must not return it again
    expect(findReceiptAttachment(msgs)?.data).not.toBe(ref.data);
  });
});

describe("totalAttachmentB64", () => {
  it("sums every attachment still in the history", () => {
    const msgs = [
      { role: "user", content: [img("1234")] },
      { role: "user", content: [txt("x"), pdf("123456")] },
    ];
    expect(totalAttachmentB64(msgs)).toBe(10);
  });
  it("ignores text-only history", () => {
    expect(totalAttachmentB64([{ role: "user", content: "hello" }])).toBe(0);
  });
});

describe("size ceilings", () => {
  it("charges PDFs and images to their own limits", () => {
    expect(maxB64For("application/pdf")).toBe(MAX_PDF_B64);
    expect(maxB64For("image/jpeg")).toBeGreaterThan(0);
  });

  // The reason the PDF cap was lowered: the whole conversation is replayed in
  // every request, and the platform rejects a body over ~4.5 MB.
  it("keeps a max-size PDF plus overhead inside the send ceiling", () => {
    expect(MAX_PDF_B64).toBeLessThan(MAX_SEND_CHARS);
    expect(MAX_SEND_CHARS).toBeLessThan(4_500_000);
  });

  it("keeps the byte cap consistent with the base64 cap", () => {
    // base64 inflates by ~4/3; the byte cap must not admit a file that the
    // base64 cap would then reject after the expensive read.
    expect(Math.ceil((MAX_PDF_BYTES * 4) / 3)).toBeLessThanOrEqual(MAX_PDF_B64);
  });

  it("bounds the accumulated history too", () => {
    expect(MAX_TOTAL_ATTACHMENT_B64).toBeGreaterThan(MAX_PDF_B64);
  });
});
