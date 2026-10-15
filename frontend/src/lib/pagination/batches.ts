/**
 * THE collection-loading rule of the showroom suite: every grid/list that can grow shows a
 * first batch of 10, "Show more" appends ONE more batch (a real bounded server read at
 * `offset = rows already shown`), and "Show less" removes ONE batch — never more.
 */
export const PAGE_BATCH = 10;

/** How many rows remain after one "Show less": the last (possibly partial) batch goes. 37→30, 30→20, 20→10, 10→10. */
export function lessCount(shown: number, batch: number = PAGE_BATCH): number {
  if (shown <= batch) return Math.min(shown, batch);
  const partial = shown % batch;
  return shown - (partial === 0 ? batch : partial);
}

/** Appends a batch without ever repeating a row already shown (rows can shift between two clicks). */
export function appendUniqueById<T extends { id: string }>(current: readonly T[], batch: readonly T[]): T[] {
  const seen = new Set(current.map((r) => r.id));
  return [...current, ...batch.filter((r) => !seen.has(r.id))];
}

export type PagedLoad<T> = (offset: number, limit: number) => Promise<{ items: T[]; total: number } | null>;
