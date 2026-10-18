"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { BookmarkFilledIcon, BookmarkIcon } from "@/components/ui/icons";
import { setOfferSavedAction } from "@/server/actions/offer-feed";

/**
 * The offer bookmark — one control for the feed cards and the detail page. It is a user
 * preference stored server-side (never browser storage), so the state survives a reload and is the
 * same everywhere. Outline = not saved; filled accent = saved. Optimistic, rolled back if the
 * server refuses (for example when the offer has just stopped being available to this viewer).
 */
export function SaveOfferButton({
  offerId,
  orgId,
  saved,
  onChange,
  className,
}: {
  offerId: string;
  orgId: string | null;
  saved: boolean;
  onChange?: (saved: boolean) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(saved);
  const [prev, setPrev] = useState(saved);
  const [pending, start] = useTransition();
  // Follow the server value when the parent re-renders with a different one (e.g. after a reload of a batch).
  if (saved !== prev) {
    setPrev(saved);
    setValue(saved);
  }

  const toggle = () => {
    const next = !value;
    setValue(next);
    start(async () => {
      const res = await setOfferSavedAction(offerId, next, orgId);
      const final = res.ok ? res.saved : !next;
      setValue(final);
      onChange?.(final);
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={value}
      aria-label={value ? t("showroomOffers.unsaveOffer") : t("showroomOffers.saveOffer")}
      title={value ? t("showroomOffers.unsaveOffer") : t("showroomOffers.saveOffer")}
      data-testid="offer-save"
      data-saved={value ? "true" : "false"}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-70",
        value ? "border-accent bg-accent-solid/15 text-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
        className,
      )}
    >
      {value ? <BookmarkFilledIcon size={18} /> : <BookmarkIcon size={18} />}
    </button>
  );
}
