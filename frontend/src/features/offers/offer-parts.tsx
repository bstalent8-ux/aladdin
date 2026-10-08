"use client";

import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { ProductMedia } from "@/features/commerce/product-media";
import { BadgeCheckIcon, CalendarIcon, ClockIcon, PauseIcon, PlayIcon, PencilIcon, InboxIcon, PackageIcon, TrashIcon } from "@/components/ui/icons";
import { formatProductPrice } from "@/features/showroom-shell/products/price-format";
import type { ComponentType } from "react";
import { daysLeft, productsLabel, type OfferPhase } from "./offer-model";
import { formatOfferDate } from "./offer-datetime";

/** Phase -> semantic tokens only (success = the active state, warning = paused, danger = ended). */
const PHASE_STYLE: Record<OfferPhase, { box: string; Icon: ComponentType<{ size?: number }> }> = {
  draft: { box: "border-strong text-fg-secondary", Icon: PencilIcon },
  scheduled: { box: "border-accent/50 text-accent", Icon: ClockIcon },
  active: { box: "border-success/60 text-success", Icon: PlayIcon },
  paused: { box: "border-warning/60 text-warning", Icon: PauseIcon },
  expired: { box: "border-danger/50 text-danger", Icon: InboxIcon },
  archived: { box: "border-strong text-fg-muted", Icon: TrashIcon },
};

export function PhaseBadge({ phase, className }: { phase: OfferPhase; className?: string }) {
  const { t } = useI18n();
  const { box, Icon } = PHASE_STYLE[phase];
  return (
    <span
      data-testid="offer-phase"
      data-phase={phase}
      className={cn("inline-flex items-center gap-1.5 rounded-sm border bg-surface px-2.5 py-1 text-label font-semibold shadow-sm", box, className)}
    >
      <Icon size={13} />
      {t(`showroomOffers.status.${phase}`)}
    </span>
  );
}

/**
 * Up to three product photos as one picture: one photo fills it, two split it, three or more make a
 * large tile and two small ones (the reference's collage). No photo -> the neutral placeholder.
 * A count chip says how many products the package holds.
 */
export function OfferCollage({
  images,
  count,
  alt,
  aspect = "aspect-[16/9]",
  className,
}: {
  images: Array<string | null>;
  count: number;
  alt: string;
  aspect?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const shown = images.slice(0, 3);
  while (shown.length === 0) shown.push(null);
  return (
    <div className={cn("relative w-full overflow-hidden rounded-sm", className)} data-testid="offer-collage">
      {shown.length === 1 ? (
        <ProductMedia src={shown[0] ?? null} alt={alt} aspect={aspect} />
      ) : shown.length === 2 ? (
        <div className={cn("grid grid-cols-2 gap-0.5", aspect)}>
          {shown.map((src, i) => (
            <ProductMedia key={i} src={src} alt={i === 0 ? alt : ""} aspect="h-full" className="h-full" />
          ))}
        </div>
      ) : (
        <div className={cn("grid grid-cols-[2fr_1fr] grid-rows-2 gap-0.5", aspect)}>
          <ProductMedia src={shown[0] ?? null} alt={alt} aspect="h-full" className="row-span-2 h-full" />
          <ProductMedia src={shown[1] ?? null} alt="" aspect="h-full" className="h-full" />
          <ProductMedia src={shown[2] ?? null} alt="" aspect="h-full" className="h-full" />
        </div>
      )}
      <span className="absolute bottom-1.5 end-1.5 inline-flex items-center gap-1 rounded-sm border border-strong bg-surface px-2 py-0.5 text-label font-medium text-fg shadow-sm">
        <PackageIcon size={12} />
        {productsLabel(t, count)}
      </span>
    </div>
  );
}

/**
 * The offer's price block: the optional offer-level "price before the offer" struck through (as
 * typed by the owner — never computed, never a percentage) above the one package price.
 */
export function OfferPrice({
  total,
  reference,
  size = "md",
}: {
  total: number;
  reference: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();
  const cur = t("showroomOffers.builder.currency");
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid="offer-price">
      {reference !== null ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-label text-fg-muted">
          <span>{t("showroomOffers.priceBefore")}</span>
          <span className="line-through decoration-danger decoration-2" dir="ltr" data-testid="offer-reference-price">{formatProductPrice(reference, cur)}</span>
        </p>
      ) : null}
      <p className="text-label font-medium text-accent">{t("showroomOffers.offerPrice")}</p>
      <p className={cn("font-bold leading-none text-accent", size === "lg" ? "text-display" : size === "sm" ? "text-title" : "text-headline")} dir="ltr" data-testid="offer-total-price">
        {formatProductPrice(total, cur)}
      </p>
    </div>
  );
}

/** "Available until 25 Oct 2026" and, when it is close, how long is left. */
export function OfferValidity({ endsAt, locale, className, compact = false }: { endsAt: string; locale: "ar" | "en"; className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const left = daysLeft(endsAt);
  return (
    <div className={cn("flex gap-x-3 gap-y-1 text-label text-fg-secondary", compact ? "flex-col items-start" : "flex-wrap items-center justify-between", className)}>
      <span className="inline-flex items-center gap-1.5">
        <CalendarIcon size={14} className="text-accent" />
        {t("showroomOffers.validUntil", { date: formatOfferDate(endsAt, locale) })}
      </span>
      {left > 0 && left <= 7 ? (
        <span className="inline-flex items-center gap-1.5 text-accent" data-testid="offer-days-left">
          <ClockIcon size={14} />
          {left === 1 ? t("showroomOffers.dayLeft") : t("showroomOffers.daysLeft", { count: String(left) })}
        </span>
      ) : null}
    </div>
  );
}

export function SellerLine({ name, verified, typeLabel, compact = false }: { name: string; verified: boolean; typeLabel: string | null; compact?: boolean }) {
  const { t } = useI18n();
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="offer-seller">
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full border border-strong bg-surface-2 text-label font-bold text-accent", compact ? "h-8 w-8" : "h-9 w-9")}>
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("flex min-w-0 items-center gap-1 font-semibold text-fg", compact ? "text-label" : "text-body")}>
          <span className="truncate" dir="auto">{name}</span>
          {verified ? (
            <span className="shrink-0 text-info" title={t("showroomOffers.verified")}>
              <BadgeCheckIcon size={14} />
            </span>
          ) : null}
        </span>
        {typeLabel ? <span className="truncate text-label text-fg-muted">{typeLabel}</span> : null}
      </span>
    </div>
  );
}
