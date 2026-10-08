import { useCallback, useRef, useState } from "react";

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

/**
 * Client state for one bounded collection. Mount it with `key={filterKey}` so any
 * filter/search/sort change starts over from the first batch with the new server-rendered rows.
 */
export function usePagedList<T extends { id: string }>(initial: readonly T[], initialTotal: number, load: PagedLoad<T>) {
  const [items, setItems] = useState<T[]>([...initial]);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  const more = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    const res = await load(items.length, PAGE_BATCH);
    if (id !== request.current) return;
    setLoading(false);
    if (!res) return setFailed(true);
    setItems((prev) => appendUniqueById(prev, res.items));
    setTotal(res.total);
  }, [items.length, load]);

  const less = useCallback(() => {
    request.current++; // a batch still in flight must not re-extend the list
    setLoading(false);
    setItems((prev) => prev.slice(0, lessCount(prev.length)));
  }, []);

  return { items, setItems, total, loading, failed, more, less, hasMore: items.length < total, canLess: items.length > PAGE_BATCH };
}
