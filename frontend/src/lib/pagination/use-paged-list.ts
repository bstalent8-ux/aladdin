"use client";

import { useCallback, useRef, useState } from "react";
import { PAGE_BATCH, appendUniqueById, lessCount, type PagedLoad } from "./batches";

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

  /** Drop one row the user just removed (e.g. un-saved); the server total shrinks with it. */
  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setTotal((n) => Math.max(0, n - 1));
  }, []);

  return { items, setItems, remove, total, loading, failed, more, less, hasMore: items.length < total, canLess: items.length > PAGE_BATCH };
}
