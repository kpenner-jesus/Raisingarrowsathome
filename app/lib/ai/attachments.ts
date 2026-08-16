// ============================================================
//  attachments.ts — ONE definition of "which attached file is the
//  receipt", shared by the chat route (which feeds create_receipt) and
//  the loop (which strips the file once it's been used).
//
//  Why it's shared: these two used to select independently — the route
//  filtered on media type, the strip matched on block type alone. Any
//  divergence means either a consumed file is replayed and re-billed
//  forever, or an untouched one is destroyed. Selecting once and
//  returning the POSITION makes them consistent by construction.
//
//  Why the lookback is bounded: a photo in an admin chat is nearly always
//  a receipt, but a PDF plausibly isn't — a budget, a policy, a letter.
//  An unbounded newest-first scan would let a PDF attached six turns ago
//  for an unrelated question become the stored evidence for a receipt
//  created later. The window covers the natural flows (attach and ask in
//  one message; attach, then clarify in the next) and stops there.
// ============================================================

import type Anthropic from "@anthropic-ai/sdk";

export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const PDF_TYPE = "application/pdf";

export const MAX_IMAGE_B64 = 7_000_000;   // ~5.2 MB binary; Anthropic's per-image limit is 5 MB
// Kept well under the ~4.5 MB serverless request-body limit: the whole
// conversation is replayed in every request, so the file plus its history
// must fit. A phone-scanned receipt PDF is typically under 500 KB.
export const MAX_PDF_B64   = 3_000_000;   // ~2.2 MB binary

/** Ceiling on ALL attachments still in the replayed history. Anthropic's
 *  request limit is 32 MB; stop well short so the failure is a clear message
 *  rather than a provider error the admin can't act on. */
export const MAX_TOTAL_ATTACHMENT_B64 = 20_000_000;

/** Byte ceilings applied to the FILE, before it's read into memory — base64ing
 *  a huge file just to reject it freezes (or kills) the browser tab. */
export const MAX_PDF_BYTES    = 2_200_000;
export const MAX_ATTACH_BYTES = 25_000_000;

/** Client-side pre-flight for the whole POST body; mirrors the route's own
 *  MAX_BODY_CHARS so an over-large chat fails with a readable message
 *  instead of an opaque platform rejection. */
export const MAX_SEND_CHARS = 3_800_000;

/** How many of the admin's own messages back to look for the receipt file. */
export const ATTACHMENT_LOOKBACK_USER_TURNS = 2;

export interface AttachmentRef {
  data:         string;
  mediaType:    string;
  /** Position in the replayed array, so the strip hits the SAME block. */
  messageIndex: number;
  blockIndex:   number;
}

/** The single test for "this block is a usable attachment". */
export function attachmentMediaType(block: any): string | null {
  const src = block?.source;
  if (src?.type !== "base64" || typeof src.data !== "string" || !src.data) return null;
  if (block.type === "image"    && ALLOWED_IMAGE_TYPES.has(src.media_type)) return src.media_type;
  if (block.type === "document" && src.media_type === PDF_TYPE)            return PDF_TYPE;
  return null;
}

/** A user message that is purely tool_result plumbing, not something the
 *  admin typed. These don't count against the lookback window. */
function isToolResultOnly(content: any): boolean {
  return Array.isArray(content) && content.length > 0
    && content.every((b: any) => b?.type === "tool_result");
}

/**
 * Find the attachment a create_receipt should consume: the newest one inside
 * the last ATTACHMENT_LOOKBACK_USER_TURNS admin-authored messages.
 * Returns null when nothing recent qualifies — create_receipt then refuses
 * rather than silently reaching for an older, unrelated file.
 */
export function findReceiptAttachment(messages: any[]): AttachmentRef | null {
  let userTurns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = msg?.content;
    if (!Array.isArray(content)) continue;

    const plumbing = isToolResultOnly(content);
    if (msg?.role === "user" && !plumbing) {
      userTurns++;
      if (userTurns > ATTACHMENT_LOOKBACK_USER_TURNS) return null;
    }

    for (let j = content.length - 1; j >= 0; j--) {
      const mediaType = attachmentMediaType(content[j]);
      if (mediaType) {
        return { data: content[j].source.data, mediaType, messageIndex: i, blockIndex: j };
      }
    }
  }
  return null;
}

/** Total base64 weight of every attachment still in the history. */
export function totalAttachmentB64(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = msg?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (attachmentMediaType(block)) total += block.source.data.length;
    }
  }
  return total;
}

/** Per-type ceiling for one attachment. */
export function maxB64For(mediaType: string): number {
  return mediaType === PDF_TYPE ? MAX_PDF_B64 : MAX_IMAGE_B64;
}

/**
 * Replace a consumed attachment with a light text marker, so a multi-MB file
 * isn't replayed — and re-billed — on every later turn. Takes the ref the
 * route already selected, so it can never strip a different block.
 */
export function stripAttachmentAt(messages: Anthropic.MessageParam[], ref: AttachmentRef): void {
  const content = messages[ref.messageIndex]?.content as any[] | undefined;
  if (!Array.isArray(content)) return;
  const block = content[ref.blockIndex];
  if (!block || attachmentMediaType(block) !== ref.mediaType) return; // moved — leave it alone
  content[ref.blockIndex] = {
    type: "text",
    text: ref.mediaType === PDF_TYPE ? "[receipt PDF — entered]" : "[receipt photo — entered]",
  };
}
