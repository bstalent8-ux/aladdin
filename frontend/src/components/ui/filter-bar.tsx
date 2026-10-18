"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LIVE_SEARCH_DEBOUNCE_MS, normalizeSearchInput } from "@/lib/search/normalize";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, Button, Spinner } from "@/components/ui/controls";
import { SearchIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * One canonical list toolbar: free-text search plus zero or more dropdown filters,
 * all expressed in the URL so the server refetches inside RLS. A filter can narrow
 * results but never widen them past what the database already allows.
 *
 * Selects apply immediately (the expected behaviour for a small option set);
 * the text field applies on submit so typing does not fire a request per keystroke —
 * unless `liveSearch` is set: then there is no Search button, the field applies itself
 * once typing pauses (300 ms), Enter applies at once, and other filters are kept.
 */
export type FilterSelect = {
  /** Query-string parameter this select writes. */
  name: string;
  label: string;
  value: string;
  /** The "no filter" option label. Its value is always the empty string. */
  anyLabel: string;
  options: { value: string; label: string }[];
};

export function FilterBar({
  basePath,
  search,
  selects = [],
  clearLabel,
  variant = "card",
  liveSearch = false,
}: {
  basePath: string;
  search?: { name: string; value: string; placeholder: string };
  selects?: FilterSelect[];
  /** Shown only while at least one filter is set — a permanently visible
   *  "clear" on an unfiltered toolbar is a control that does nothing. */
  clearLabel?: string;
  /**
   * `card` (default) is the free-standing toolbar every existing caller
   * still gets: its own bordered, shadowed surface and bottom margin.
   * `flush` drops all of that so the bar can be composed INSIDE a surface a
   * caller already owns (a divider under a hero, say) without nesting one
   * Card's border and shadow inside another's.
   */
  variant?: "card" | "flush";
  /** Search as you type (debounced, case-insensitive on the server) with no Search button. */
  liveSearch?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search?.value ?? "");
  const [pending, startTransition] = useTransition();
  /** The last value this bar sent; a different server value means someone ELSE changed the URL. */
  const sent = useRef(normalizeSearchInput(search?.value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    const href = qs ? `${basePath}?${qs}` : basePath;
    if (replace) startTransition(() => router.replace(href));
    else router.push(href);
  };

  const apply = (value: string) => {
    const normalized = normalizeSearchInput(value);
    if (normalized === sent.current) return;
    sent.current = normalized;
    if (search) push({ [search.name]: normalized }, true);
  };

  useEffect(() => {
    if (!liveSearch) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(q), LIVE_SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` only reads refs and the latest params
  }, [q, liveSearch]);

  const serverQ = search?.value ?? "";
  useEffect(() => {
    // The URL changed from outside (clear filters, back button): follow it, but never overwrite what is being typed.
    if (!liveSearch) return;
    if (normalizeSearchInput(serverQ) !== sent.current) {
      sent.current = normalizeSearchInput(serverQ);
      setQ(serverQ);
    }
  }, [serverQ, liveSearch]);

  return (
    <form
      role="search"
      data-no-dirty
      className={cn(
        "flex flex-wrap items-end gap-sm",
        variant === "card" && "mb-lg rounded-md border bg-surface p-sm shadow-card",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (!search) return;
        if (liveSearch) apply(q);
        else push({ [search.name]: q });
      }}
    >
      {search ? (
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">{search.placeholder}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted"
          >
            <SearchIcon size={16} />
          </span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className={liveSearch ? "ps-9 pe-9" : "ps-9"}
            {...(liveSearch ? { "data-testid": "live-search-input", autoComplete: "off", enterKeyHint: "search" as const } : {})}
          />
          {liveSearch && pending ? (
            <span aria-hidden="true" data-testid="live-search-busy" className="pointer-events-none absolute inset-y-0 end-3 flex items-center">
              <Spinner className="text-fg-muted" />
            </span>
          ) : null}
        </label>
      ) : null}

      {selects.map((s) => (
        <label key={s.name} className="min-w-0 basis-44">
          <span className="sr-only">{s.label}</span>
          <Select value={s.value} aria-label={s.label} onChange={(e) => push({ [s.name]: e.target.value })}>
            <option value="">{s.anyLabel}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ))}

      {search && !liveSearch ? (
        <Button type="submit" variant="outline">
          {t("common.search")}
        </Button>
      ) : null}

      {clearLabel && (q || selects.some((s) => s.value)) ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQ("");
            sent.current = "";
            router.push(basePath);
          }}
        >
          {clearLabel}
        </Button>
      ) : null}
    </form>
  );
}
