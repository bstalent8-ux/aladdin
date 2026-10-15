"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { PAGE_BATCH } from "@/lib/pagination/batches";

/**
 * The one "Show more / Show less" control for every bounded collection: a compact
 * "Showing N of M" line and two real buttons. Counts use Latin digits. When the button
 * that was just pressed disappears (the end was reached / back at the first batch), focus
 * moves to the surviving one so keyboard users never lose their place.
 */
export function Pager({
  shown,
  total,
  loading,
  failed,
  onMore,
  onLess,
  testId = "collection",
  className,
}: {
  shown: number;
  total: number;
  loading?: boolean;
  failed?: boolean;
  onMore: () => void;
  onLess: () => void;
  testId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const hasMore = shown < total;
  const canLess = shown > PAGE_BATCH;
  const moreRef = useRef<HTMLButtonElement>(null);
  const lessRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<"more" | "less" | null>(null);

  useEffect(() => {
    if (pressed.current === "more" && !hasMore) lessRef.current?.focus();
    if (pressed.current === "less" && !canLess) moreRef.current?.focus();
    pressed.current = null;
  }, [shown, hasMore, canLess]);

  if (!hasMore && !canLess) return null;
  return (
    <div className={className ?? "flex flex-col items-center gap-2"} data-testid={`${testId}-pager`}>
      <p className="text-label text-fg-muted" data-testid={`${testId}-shown`} aria-live="polite">
        {t("pager.shown", { shown: String(shown), total: String(total) })}
      </p>
      {failed ? <p role="alert" className="text-label text-danger" data-testid={`${testId}-load-error`}>{t("pager.loadError")}</p> : null}
      <div className="flex flex-wrap items-center justify-center gap-sm">
        {hasMore ? (
          <Button
            ref={moreRef}
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              pressed.current = "more";
              onMore();
            }}
            data-testid={`${testId}-show-more`}
          >
            {loading ? t("pager.loading") : t("common.showMore")}
          </Button>
        ) : null}
        {canLess ? (
          <Button
            ref={lessRef}
            type="button"
            variant="ghost"
            onClick={() => {
              pressed.current = "less";
              onLess();
            }}
            data-testid={`${testId}-show-less`}
          >
            {t("common.showLess")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
