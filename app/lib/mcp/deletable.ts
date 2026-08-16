// ============================================================
//  deletable.ts — what the admin assistant is allowed to delete,
//  and what deleting it takes down with it.
//
//  Deletion exists because bad data gets IN: a double-import can stamp
//  payouts as "paid" that never happened, and until now nothing could
//  remove them — the money looked spent and the family looked settled.
//
//  Three rules make this safe enough to hand to an assistant:
//
//   1. WHITELIST. Only the tables here can be touched. The tenant row,
//      org membership, profiles and the audit log itself are absent on
//      purpose — nothing in a chat should be able to delete the record
//      of what a chat did.
//   2. ARCHIVE FIRST. The full row is written to audit_log BEFORE the
//      delete, and the delete is abandoned if that write fails. A
//      mistaken delete is then recoverable from the audit row.
//   3. NO SILENT CASCADES. Postgres will happily take a recipient's
//      receipts, photos, testimonials, payouts AND notes with it. The
//      caller must be shown the counts and pass cascade: true.
//
//  The relationships below were read from the LIVE database, not from the
//  repo's migrations — recipient_notes, application_notes and the
//  receipts.duplicate_of_id self-link are all absent from the checked-in
//  SQL, and every one of them would have been under-reported. If a table
//  is added later, verify its foreign keys against the database:
//    select conname, confdeltype from pg_constraint where contype = 'f';
// ============================================================

export interface ChildRel {
  table: string;
  /** Column on the child pointing at the row being deleted. */
  fk: string;
}

export interface DeletableSpec {
  /** Plain-English singular, used in every message the admin sees. */
  label: string;
  /** Children Postgres DELETES along with this row (on delete cascade). */
  cascades: ChildRel[];
  /** Children that BLOCK the delete at the DB level (on delete restrict). */
  restricts: ChildRel[];
  /** Children that survive but lose the link (on delete set null). */
  unlinks: ChildRel[];
  /** Stored file to clean up so the delete doesn't orphan an object. */
  storage?: { bucket: string; column: string };
  /** Deleting this changes what a family is owed — say so in the preview. */
  affectsBalance?: boolean;
}

export const DELETABLE: Record<string, DeletableSpec> = {
  payouts: {
    label: "payout",
    cascades: [], restricts: [], unlinks: [],
    affectsBalance: true,
  },
  receipts: {
    label: "receipt",
    cascades: [], restricts: [],
    // receipts.duplicate_of_id -> receipts ON DELETE SET NULL: other receipts
    // flagged as duplicates OF this one survive, but stop pointing at it.
    unlinks: [{ table: "receipts", fk: "duplicate_of_id" }],
    storage: { bucket: "receipts", column: "image_path" },
    affectsBalance: true,
  },
  photos: {
    label: "photo",
    cascades: [], restricts: [], unlinks: [],
    storage: { bucket: "photos", column: "image_path" },
  },
  testimonials: {
    label: "testimonial",
    cascades: [], restricts: [], unlinks: [],
  },
  payout_batches: {
    label: "payout batch",
    cascades: [], restricts: [],
    // payouts.batch_id is ON DELETE SET NULL — the payouts SURVIVE, they
    // just stop belonging to a batch. Worth saying, or it reads as a
    // bigger delete than it is.
    unlinks: [{ table: "payouts", fk: "batch_id" }],
  },
  recipients: {
    label: "recipient",
    // All ON DELETE CASCADE. recipient_notes is NOT in 001_init.sql —
    // it came from the live schema, and omitting it would have meant
    // silently destroying a family's notes.
    cascades: [
      { table: "receipts",        fk: "recipient_id" },
      { table: "photos",          fk: "recipient_id" },
      { table: "testimonials",    fk: "recipient_id" },
      { table: "payouts",         fk: "recipient_id" },
      { table: "recipient_notes", fk: "recipient_id" },
    ],
    restricts: [], unlinks: [],
    affectsBalance: true,
  },
  applications: {
    label: "application",
    cascades: [{ table: "application_notes", fk: "application_id" }],
    // recipients.application_id is ON DELETE RESTRICT — the DB refuses.
    // Catch it here so the admin gets a sentence, not a Postgres error.
    restricts: [{ table: "recipients", fk: "application_id" }],
    unlinks: [],
  },
};

export const DELETABLE_TABLES = Object.keys(DELETABLE);

export function specFor(table: string): DeletableSpec {
  const spec = DELETABLE[table];
  if (!spec) {
    throw new Error(
      `"${table}" can't be deleted from chat. Deletable records: ${DELETABLE_TABLES.join(", ")}.`,
    );
  }
  return spec;
}

/** Minimum characters of justification. Written into the audit row. */
export const MIN_REASON_LEN = 10;

export function assertReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < MIN_REASON_LEN) {
    throw new Error(
      "A reason is required to delete a record — say why in a short sentence (it is written to the audit log).",
    );
  }
  return r.slice(0, 500);
}

/** One-line summary of the collateral, for the confirm card and the model. */
export function describeImpact(
  spec: DeletableSpec,
  counts: Record<string, number>,
): { destroys: string[]; unlinks: string[]; blockedBy: string[] } {
  const n = (rel: ChildRel) => counts[`${rel.table}.${rel.fk}`] ?? 0;
  return {
    destroys:  spec.cascades.filter((r) => n(r) > 0).map((r) => `${n(r)} ${r.table}`),
    unlinks:   spec.unlinks.filter((r) => n(r) > 0).map((r) => `${n(r)} ${r.table}`),
    blockedBy: spec.restricts.filter((r) => n(r) > 0).map((r) => `${n(r)} ${r.table}`),
    // keyed by table+fk: a table can legitimately appear in two lists
    // (e.g. a self-link), and a table-only key would silently overwrite.
  };
}
