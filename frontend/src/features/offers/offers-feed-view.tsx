"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { type CatalogView } from "@/lib/ui/catalog-view";
import { Button, Input } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatePanel } from "@/components/ui/primitives";
import { ClockIcon, SearchIcon, TagIcon, SparklesIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { isAudienceCode, sellerTypeLabel, type PublicOffer, productsLabel } from "./offer-model";
import { OfferCollage, OfferPrice, OfferValidity, SellerLine } from "./offer-parts";

type SortKey = "newest" | "ending" | "priceLow" | "priceHigh";
type ValidityKey = "all" | "ending" | "week";

const DAY = 86_400_000;

/**
 * The audience Offers feed — account-agnostic. It receives the offers the DATABASE already decided
 * this workspace may see (offers_feed), and only narrows them for the reader: search, category,
 * seller type, validity and sort never widen what the backend allowed.
 */
export function OffersFeedView({
  offers,
  imageUrls,
  locale,
  initialView,
  detailBase = `${SHOWROOM_ROOT}/offers`,
}: {
  offers: PublicOffer[];
  imageUrls: Record<string, string>;
  locale: "ar" | "en";
  initialView: CatalogView;
  detailBase?: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [seller, setSeller] = useState("");
  const [validity, setValidity] = useState<ValidityKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const now = useMemo(() => Date.now(), []);
  const stats = useMemo(
    () => ({
      available: offers.length,
      ending: offers.filter((o) => new Date(o.endsAt).getTime() - now <= 3 * DAY).length,
      fresh: offers.filter((o) => o.publishedAt && now - new Date(o.publishedAt).getTime() <= 7 * DAY).length,
    }),
    [offers, now],
  );

  const sellerTypes = useMemo(() => [...new Set(offers.map((o) => o.seller.orgType).filter((v): v is string => Boolean(v) && isAudienceCode(v)))], [offers]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = offers.filter((o) => {
      if (term && !`${o.title} ${o.seller.name} ${o.items.map((i) => `${i.name} ${i.code ?? ""}`).join(" ")}`.toLowerCase().includes(term)) return false;
      if (category && !o.items.some((i) => i.categoryCode === category)) return false;
      if (seller && o.seller.orgType !== seller) return false;
      const remaining = new Date(o.endsAt).getTime() - now;
      if (validity === "ending" && remaining > 3 * DAY) return false;
      if (validity === "week" && remaining > 7 * DAY) return false;
      return true;
    });
    const by: Record<SortKey, (a: PublicOffer, b: PublicOffer) => number> = {
      newest: (a, b) => new Date(b.publishedAt ?? b.startsAt).getTime() - new Date(a.publishedAt ?? a.startsAt).getTime(),
      ending: (a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
      priceLow: (a, b) => a.totalPrice - b.totalPrice,
      priceHigh: (a, b) => b.totalPrice - a.totalPrice,
    };
    return [...list].sort(by[sort]);
  }, [offers, q, category, seller, validity, sort, now]);

  const filtered = Boolean(q || category || seller || validity !== "all");
  const clear = () => {
    setQ("");
    setCategory("");
    setSeller("");
    setValidity("all");
  };

  const chips = [{ value: "", label: t("showroomOffers.feed.chipAll") }, ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) }))];

  return (
    <div className="flex flex-col gap-md" data-testid="offers-feed">
      <ul className="grid grid-cols-1 gap-sm tablet:grid-cols-3 tablet:gap-md" data-testid="offers-stats">
        {[
          { key: "available", label: t("showroomOffers.feed.statAvailable"), value: stats.available, Icon: TagIcon },
          { key: "ending", label: t("showroomOffers.feed.statEnding"), value: stats.ending, Icon: ClockIcon },
          { key: "new", label: t("showroomOffers.feed.statNew"), value: stats.fresh, Icon: SparklesIcon },
        ].map(({ key, label, value, Icon }) => (
          <li key={key} className="flex items-center justify-between gap-3 rounded-md border bg-surface p-sm shadow-card tablet:p-md" data-testid={`offers-stat-${key}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent">
              <Icon size={20} />
            </span>
            <span className="min-w-0 text-end">
              <span className="block text-headline font-bold leading-none text-fg" dir="ltr">{String(value)}</span>
              <span className="mt-1 block text-label text-fg-secondary">{label}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-sm" data-testid="offers-toolbar">
        <div className="flex flex-wrap items-stretch gap-sm">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">{t("showroomOffers.feed.searchPlaceholder")}</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted">
              <SearchIcon size={16} />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("showroomOffers.feed.searchPlaceholder")} className="ps-9" data-testid="offers-search" />
          </label>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={category}
              aria-label={t("showroomOffers.feed.category")}
              onChange={setCategory}
              data-testid="offers-category"
              options={[{ value: "", label: t("showroomOffers.feed.allCategories") }, ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) }))]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={seller}
              aria-label={t("showroomOffers.feed.sellerType")}
              onChange={setSeller}
              data-testid="offers-seller-type"
              options={[{ value: "", label: t("showroomOffers.feed.allSellerTypes") }, ...sellerTypes.map((c) => ({ value: c, label: t(`showroomOffers.audience.${c}`) }))]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={validity}
              aria-label={t("showroomOffers.feed.validity")}
              onChange={(v) => setValidity(v as ValidityKey)}
              data-testid="offers-validity"
              options={[
                { value: "all", label: t("showroomOffers.feed.validityAll") },
                { value: "ending", label: t("showroomOffers.feed.validityEnding") },
                { value: "week", label: t("showroomOffers.feed.validityWeek") },
              ]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={sort}
              aria-label={t("showroomOffers.feed.sort")}
              onChange={(v) => setSort(v as SortKey)}
              data-testid="offers-sort"
              options={[
                { value: "newest", label: t("showroomOffers.feed.sortNewest") },
                { value: "ending", label: t("showroomOffers.feed.sortEnding") },
                { value: "priceLow", label: t("showroomOffers.feed.sortPriceLow") },
                { value: "priceHigh", label: t("showroomOffers.feed.sortPriceHigh") },
              ]}
            />
          </div>
        </div>
        <nav aria-label={t("showroomOffers.feed.category")} className="min-w-0 overflow-x-auto pb-1" data-testid="offers-chips">
          <ul className="flex w-max min-w-full gap-2">
            {chips.map((chip) => (
              <li key={chip.value || "all"} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={chip.value === category}
                  onClick={() => setCategory(chip.value)}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    chip.value === category ? "border-transparent bg-accent-solid text-on-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  {chip.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="flex items-center justify-between gap-sm">
        <p className="text-title font-semibold text-fg" data-testid="offers-count" dir="auto">{t("showroomOffers.feed.count", { count: String(shown.length) })}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="offers" />
      </div>

      {shown.length === 0 ? (
        <StatePanel
          icon={<TagIcon size={22} />}
          title={filtered ? t("showroomOffers.feed.noResultsTitle") : t("showroomOffers.feed.emptyTitle")}
          body={filtered ? t("showroomOffers.feed.noResultsBody") : t("showroomOffers.feed.emptyBody")}
          action={filtered ? <Button type="button" variant="ghost" onClick={clear}>{t("showroomOffers.feed.clearFilters")}</Button> : undefined}
        />
      ) : view === "grid" ? (
        <ul className="grid grid-cols-1 gap-sm tablet:grid-cols-2 tablet:gap-md desktop:grid-cols-3 wide:grid-cols-4" data-testid="offers-grid">
          {shown.map((o) => (
            <li key={o.id} className="min-w-0">
              <OfferCard offer={o} imageUrls={imageUrls} locale={locale} detailBase={detailBase} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="offers-list">
          {shown.map((o) => (
            <li key={o.id} className="min-w-0">
              <OfferRow offer={o} imageUrls={imageUrls} locale={locale} detailBase={detailBase} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const offerImages = (offer: PublicOffer, imageUrls: Record<string, string>): string[] =>
  offer.items
    .map((i) => (i.imageKey ? imageUrls[i.imageKey] : undefined) ?? i.imageRef ?? null)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);

function OfferCard({ offer, imageUrls, locale, detailBase }: { offer: PublicOffer; imageUrls: Record<string, string>; locale: "ar" | "en"; detailBase: string }) {
  const { t } = useI18n();
  const lines = offer.items.slice(0, 3);
  const more = offer.items.length - lines.length;
  return (
    <article className="flex h-full flex-col gap-2 rounded-md border bg-surface p-sm shadow-card transition-colors hover:border-strong" data-testid="offer-card">
      <SellerLine name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
      <Link href={`${detailBase}/${offer.id}`} aria-label={offer.title} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <OfferCollage images={offerImages(offer, imageUrls)} count={offer.items.length} alt={offer.title} />
      </Link>
      <h3 className="line-clamp-2 text-body font-semibold leading-snug text-fg" dir="auto">{offer.title}</h3>
      <ul className="flex flex-col gap-0.5 text-label text-fg-secondary" data-testid="offer-lines">
        {lines.map((i) => (
          <li key={i.productId} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid" />
            <span className="shrink-0" dir="ltr">{t("showroomOffers.quantityTimes", { count: String(i.quantity) })}</span>
            <span className="truncate" dir="auto">{i.name}</span>
          </li>
        ))}
        {more > 0 ? <li className="text-accent" data-testid="offer-more">{t("showroomOffers.moreProducts", { count: String(more) })}</li> : null}
      </ul>
      <div className="mt-auto flex flex-col gap-2 border-t pt-2">
        <OfferPrice total={offer.totalPrice} reference={offer.referencePrice} />
        <OfferValidity endsAt={offer.endsAt} locale={locale} />
        <Link
          href={`${detailBase}/${offer.id}`}
          className="inline-flex min-h-10 items-center justify-center rounded-sm bg-accent-solid px-md text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          data-testid="offer-view-details"
        >
          {t("showroomOffers.viewDetails")}
        </Link>
      </div>
    </article>
  );
}

function OfferRow({ offer, imageUrls, locale, detailBase }: { offer: PublicOffer; imageUrls: Record<string, string>; locale: "ar" | "en"; detailBase: string }) {
  const { t } = useI18n();
  return (
    <article className="flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-sm tablet:flex-nowrap" data-testid="offer-row">
      <div className="w-28 shrink-0 tablet:w-40">
        <OfferCollage images={offerImages(offer, imageUrls)} count={offer.items.length} alt={offer.title} aspect="aspect-[4/3]" />
      </div>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <SellerLine name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
        <h3 className="line-clamp-2 text-body font-semibold text-fg" dir="auto">{offer.title}</h3>
        <p className="truncate text-label text-fg-muted">{productsLabel(t, offer.items.length)} • {offer.items.slice(0, 2).map((i) => i.name).join("، ")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 tablet:w-56">
        <OfferPrice total={offer.totalPrice} reference={offer.referencePrice} />
        <OfferValidity endsAt={offer.endsAt} locale={locale} />
      </div>
      <Link href={`${detailBase}/${offer.id}`} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-sm bg-accent-solid px-md text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {t("showroomOffers.viewDetails")}
      </Link>
    </article>
  );
}

