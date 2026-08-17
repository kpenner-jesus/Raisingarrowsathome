// ============================================================
//  application-columns.ts — flattening the two jsonb columns on
//  `applications` into spreadsheet columns.
//
//  Pure, so the column layout can be tested without a database.
// ============================================================

export interface ChildLike { age?: unknown; grade?: unknown }

/** Hard ceiling on generated answer columns, so one stray row can't
 *  produce a thousand-column file. */
export const MAX_ANSWER_COLUMNS = 40;

/** "8 (Grade 3), 10 (Grade 5)" — readable in one cell. */
export function childrenSummary(children: unknown): string {
  if (!Array.isArray(children)) return "";
  return children
    .map((c: ChildLike) => {
      const age = c?.age === null || c?.age === undefined || c?.age === "" ? "" : String(c.age);
      const grade = c?.grade ? String(c.grade) : "";
      if (age && grade) return `${age} (${grade})`;
      return age || grade;
    })
    .filter(Boolean)
    .join(", ");
}

export function childrenCount(children: unknown): number {
  return Array.isArray(children) ? children.length : 0;
}

export interface AnswerColumn {
  key:    string;
  header: string;
}

/**
 * Decide the answer columns for a set of rows.
 *
 * Keys come from the funnel config at the time of submission, and that config
 * gets edited — so historic rows can carry keys the current config has never
 * heard of. Rather than drop them, known keys are laid out in CONFIG order
 * (which keeps the column layout stable month to month, so an admin's
 * spreadsheet formula doesn't shift because one applicant carried a stray key)
 * and unknown keys follow alphabetically.
 *
 * Headers are prefixed `Q{n}.` or `answers.` so they stay unique even when two
 * questions share identical text — otherwise the file would silently contain
 * two identically-named columns.
 */
export function answerColumns(
  rows: Array<{ answers?: unknown }>,
  configKeys: Array<{ key: string; question: string }>,
  max: number = MAX_ANSWER_COLUMNS,
): { columns: AnswerColumn[]; truncated: number } {
  const present = new Set<string>();
  for (const r of rows) {
    if (r?.answers && typeof r.answers === "object") {
      for (const k of Object.keys(r.answers as Record<string, unknown>)) present.add(k);
    }
  }

  const known: AnswerColumn[] = [];
  configKeys.forEach((q, i) => {
    if (present.has(q.key)) {
      known.push({ key: q.key, header: `Q${i + 1}. ${q.question}` });
      present.delete(q.key);
    }
  });

  const unknown: AnswerColumn[] = Array.from(present)
    .sort()
    .map((k) => ({ key: k, header: `answers.${k}` }));

  const all = [...known, ...unknown];
  return { columns: all.slice(0, max), truncated: Math.max(0, all.length - max) };
}

/** Read one answer as a string, tolerating missing keys and non-strings. */
export function answerValue(answers: unknown, key: string): string {
  if (!answers || typeof answers !== "object") return "";
  const v = (answers as Record<string, unknown>)[key];
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}
