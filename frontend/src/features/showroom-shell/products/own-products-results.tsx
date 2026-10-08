"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { CatalogView } from "@/lib/ui/catalog-view";
import { CameraIcon, CheckIcon, PencilIcon, TagIcon } from "@/components/ui/icons";
import { Pager } from "@/components/ui/pager";
import { type PagedLoad } from "@/lib/pagination/batches";
import { usePagedList } from "@/lib/pagination/use-paged-list";
import { loadMyProductsBatchAction } from "@/server/actions/own-products-feed";
import { ProductMedia } from "@/features/commerce/product-media";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { ActiveSwitch, ArchiveAction, RestoreAction, cardActionClass } from "./lifecycle-controls";
import { SwatchRow } from "./color-swatches";
import type { ProductColor } from "./color-items";
import { formatProductPrice } from "./price-format";
import { ownCategoryLabel, productMetaLine } from "./labels";
import { ownProductStatus, type OwnProductStatus } from "./product-input";

export type OwnProductCard = {
  id: string;
  name: string;
  code: string | null;
  categoryCode: string | null;
  unit: string;
  status: string;
  archivedAt: string | null;
  version: number;
  imageUrl: string | null;
  sizeLabel: string | null;
  weightKg: number | null;
  colors: ProductColor[];
  /** Regular selling price in EGP; null for a historical product with none recorded. */
  basePrice: number | null;
  /** Real offer state from the offers domain (never a price or a discount): live now, or sitting in a draft / scheduled / paused offer. */
  offerState?: "active" | "included";
};

const editHref = (id: string) => `${SHOWROOM_ROOT}/my-products/${id}/edit`;

/**
 * The management view of the organization's own products: the same Grid / List
 * toggle and cookie as Browse products, but each product carries its status and
 * the lifecycle controls — this is not the public catalog, so management actions
 * belong here. (The public card stays in the catalog; the two have different jobs.)
 */
export function OwnProductsResults({
  products,
  total,
  filters,
  initialView,
  canWrite,
  canPublish,
}: {
  /** The FIRST batch (server-rendered); further batches are bounded server reads. */
  products: OwnProductCard[];
  /** Everything the current filters match — never just the batch on screen. */
  total: number;
  filters: { q?: string; category?: string; status?: string; sort?: string };
  initialView: CatalogView;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const load = useCallback<PagedLoad<OwnProductCard>>(
    async (offset) => {
      const res = await loadMyProductsBatchAction(filters, offset);
      return res.ok ? { items: res.cards, total: res.total } : null;
    },
    [filters],
  );
  const list = usePagedList(products, total, load);

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomProducts.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-title font-semibold text-fg" data-testid="my-products-count">{t("showroomProducts.count", { count: String(list.total) })}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="my-products" />
      </div>
      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4 wide:grid-cols-5" data-testid="my-products-grid">
          {list.items.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} canWrite={canWrite} canPublish={canPublish} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="my-products-list">
          {list.items.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} canWrite={canWrite} canPublish={canPublish} />
            </li>
          ))}
        </ul>
      )}
      <Pager shown={list.items.length} total={list.total} loading={list.loading} failed={list.failed} onMore={() => void list.more()} onLess={list.less} testId="my-products" />
    </section>
  );
}

/**
 * ONE opaque pill (no wrapper layer): the surface fill keeps it legible on a very light
 * or very dark photo, and the semantic token carries the meaning in its text, border and
 * dot — success for active, muted warning for draft, neutral for archived.
 */
const PILL: Record<OwnProductStatus, { box: string; dot: string }> = {
  active: { box: "border-success/60 text-success", dot: "bg-success" },
  inactive: { box: "border-warning/60 text-warning", dot: "bg-warning" },
  archived: { box: "border-strong text-fg-muted", dot: "bg-fg-muted" },
};
function StatusBadge({ status }: { status: OwnProductStatus }) {
  const { t } = useI18n();
  return (
    <span
      data-testid="status-pill"
      className={cn("inline-flex items-center gap-1.5 rounded-pill border bg-surface px-2.5 py-0.5 text-label font-semibold shadow-sm", PILL[status].box)}
    >
      {status === "active" ? (
        <CheckIcon size={12} />
      ) : (
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", PILL[status].dot)} />
      )}
      {t(`showroomProducts.status.${status}`)}
    </span>
  );
}

/** "Basic metadata" line of the reference: unit • size • weight, only what the product has. */
function metaLine(t: (k: string) => string, p: OwnProductCard) {
  return productMetaLine(t, { unit: p.unit, sizeLabel: p.sizeLabel, weightKg: p.weightKg });
}

const actionLink =
  "inline-flex items-center justify-center rounded-sm border border-strong text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function PriceLine({ price }: { price: number | null }) {
  const { t } = useI18n();
  return price !== null ? (
    <p className="flex w-full items-baseline gap-1.5" data-testid="card-price">
      <span className="sr-only">{t("showroomProducts.basePrice")}: </span>
      <span className="text-body font-bold text-fg" dir="ltr">{formatProductPrice(price, t("showroomProducts.fields.currency"))}</span>
    </p>
  ) : (
    <p className="w-full text-label text-fg-muted" data-testid="card-price-none">{t("showroomProducts.noPrice")}</p>
  );
}

function OfferChip({ state }: { state?: "active" | "included" }) {
  const { t } = useI18n();
  if (!state) return null;
  return (
    <span
      data-testid="product-offer-chip"
      data-state={state}
      className={cn("inline-flex w-fit items-center gap-1 rounded-sm border px-2 py-0.5 text-label font-medium", state === "active" ? "border-success/60 text-success" : "border-strong text-fg-secondary")}
    >
      <TagIcon size={12} />
      {state === "active" ? t("showroomProducts.offerActive") : t("showroomProducts.offerIncluded")}
    </span>
  );
}

function CardActions({ product, status, canWrite }: { product: OwnProductCard; status: OwnProductStatus; canWrite: boolean }) {
  const { t } = useI18n();
  const edit = editHref(product.id);
  if (status === "archived") {
    return canWrite ? <div className="flex flex-wrap items-start gap-1.5"><RestoreAction productId={product.id} version={product.version} /></div> : null;
  }
  return (
    <div className="grid grid-cols-3 items-stretch gap-1.5 [&>*]:min-w-0">
      {canWrite ? (
        <>
          <Link href={edit} className={cn(actionLink, cardActionClass)}><PencilIcon size={14} /><span className="sr-only tablet:not-sr-only">{t("showroomProducts.edit")}</span></Link>
          <Link href={`${edit}#product-photos`} className={cn(actionLink, cardActionClass)} aria-label={t("showroomProducts.manageImages")} title={t("showroomProducts.manageImages")}><CameraIcon size={14} /><span className="sr-only tablet:not-sr-only" aria-hidden="true">{t("showroomProducts.photosShort")}</span></Link>
          <ArchiveAction productId={product.id} version={product.version} />
        </>
      ) : null}
    </div>
  );
}

function GridCard({ product, canWrite, canPublish }: { product: OwnProductCard; canWrite: boolean; canPublish: boolean }) {
  const { t } = useI18n();
  const status = ownProductStatus({ status: product.status, archived_at: product.archivedAt });
  return (
    <div className={cn("flex h-full flex-col gap-2 rounded-md border bg-surface p-2 shadow-card tablet:p-sm", status === "archived" && "opacity-80")} data-testid="my-products-card" data-status={status}>
      <Link href={editHref(product.id)} className="relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label={product.name}>
        <ProductMedia src={product.imageUrl} alt={product.name} aspect="aspect-[4/3] tablet:aspect-[16/9]" />
        <span className="absolute start-1.5 top-1.5"><StatusBadge status={status} /></span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link href={editHref(product.id)} className="line-clamp-2 w-full text-body font-semibold leading-snug text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" dir="auto">
          {product.name}
        </Link>
        {product.code ? <p className="w-full truncate text-label text-fg-muted"><span>{t("showroomProducts.code")}: </span><span dir="ltr">{product.code}</span></p> : null}
        <span className="w-fit max-w-full truncate rounded-sm bg-accent-solid/15 px-2 py-0.5 text-label font-medium text-accent">{ownCategoryLabel(t, { category_code: product.categoryCode })}</span>
        <SwatchRow colors={product.colors} />
        <p className="w-full text-label text-fg-muted" dir="auto">{metaLine(t, product)}</p>
        <PriceLine price={product.basePrice} />
        <OfferChip state={product.offerState} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        {canPublish && status !== "archived" ? <ActiveSwitch productId={product.id} version={product.version} active={status === "active"} labelled /> : <span />}
      </div>
      <CardActions product={product} status={status} canWrite={canWrite} />
    </div>
  );
}

function ListRow({ product, canWrite, canPublish }: { product: OwnProductCard; canWrite: boolean; canPublish: boolean }) {
  const { t } = useI18n();
  const status = ownProductStatus({ status: product.status, archived_at: product.archivedAt });
  return (
    <div className={cn("flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-2 tablet:flex-nowrap tablet:p-sm", status === "archived" && "opacity-80")} data-testid="my-products-row" data-status={status}>
      <Link href={editHref(product.id)} className="flex min-w-0 flex-1 basis-full items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:basis-auto">
        <div className="w-16 shrink-0 tablet:w-20">
          <ProductMedia src={product.imageUrl} alt={product.name} aspect="aspect-square" />
        </div>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-body font-medium leading-snug text-fg" dir="auto">{product.name}</span>
          {product.code ? <span className="truncate text-label text-fg-muted" dir="ltr">{product.code}</span> : null}
        </span>
      </Link>
      <span className="flex min-w-0 flex-wrap items-center gap-x-md gap-y-1 text-label tablet:flex-nowrap">
        <StatusBadge status={status} />
        <span className="min-w-0 truncate text-fg-secondary tablet:w-40">{ownCategoryLabel(t, { category_code: product.categoryCode })}</span>
        <span className="min-w-0 truncate text-fg-muted tablet:w-44" dir="auto">{metaLine(t, product)}</span>
        <span className="min-w-0 tablet:w-28"><PriceLine price={product.basePrice} /></span>
        <OfferChip state={product.offerState} />
        <SwatchRow colors={product.colors} max={4} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && status !== "archived" ? <ActiveSwitch productId={product.id} version={product.version} active={status === "active"} /> : null}
        <CardActions product={product} status={status} canWrite={canWrite} />
      </div>
    </div>
  );
}
