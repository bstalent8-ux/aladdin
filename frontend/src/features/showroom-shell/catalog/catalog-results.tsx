"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { type CatalogView } from "@/lib/ui/catalog-view";
import { Badge } from "@/components/ui/primitives";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { catalogCategoryLabel, productMetaLine } from "@/features/showroom-shell/products/labels";
import { effectiveColors } from "@/features/showroom-shell/products/color-items";
import { SwatchRow } from "@/features/showroom-shell/products/color-swatches";

type Product = CatalogRow & { id: string; category: NonNullable<CatalogRow["category"]>; unit: NonNullable<CatalogRow["unit"]> };

/** A view row whose core fields are missing is not a product the UI can describe — same rule as the detail page. */
const isRenderable = (p: CatalogRow): p is Product => Boolean(p.id && p.category && p.unit);

/**
 * The showroom's product results: one result set, two presentations.
 *
 * The mode is client state seeded from the cookie the server already read, so the
 * toggle is instant and the first paint is already the remembered layout. Both
 * modes share the same links, the same save control and the same fields; only the
 * arrangement differs. The save control always sits OUTSIDE the product link — a
 * <form> inside an <a> is invalid and saving must never navigate away.
 */
export function CatalogResults({
  products,
  orgId,
  savedIds,
  initialView,
  countLabel,
  imageUrls = {},
}: {
  /** Product id -> resolved image URL (signed primary photo, else the legacy reference). */
  imageUrls?: Record<string, string>;
  products: CatalogRow[];
  orgId: string;
  savedIds: string[];
  initialView: CatalogView;
  countLabel: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const saved = new Set(savedIds);
  const items = products.filter(isRenderable);

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomCatalog.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted" data-testid="showroom-catalog-count">{countLabel}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="showroom-catalog" />
      </div>

      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4 wide:grid-cols-5" data-testid="showroom-catalog-grid">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} orgId={orgId} saved={saved.has(p.id)} image={imageUrls[p.id] ?? p.image_ref} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="showroom-catalog-list">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} orgId={orgId} saved={saved.has(p.id)} image={imageUrls[p.id] ?? p.image_ref} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Public discovery metadata only: code, colors and "unit • size • weight". There is no
 * price here by design — Aladdin is a discovery + quotation platform, and the only price
 * another organization ever sees is a Product Offer's.
 */
function useMeta(product: Product) {
  const { t } = useI18n();
  return {
    meta: productMetaLine(t, { unit: product.unit, sizeLabel: product.size_label, weightKg: product.weight_kg }),
    colors: effectiveColors(product),
  };
}

const detailHref = (id: string) => `${SHOWROOM_ROOT}/catalog/${id}`;

function Supplier({ product }: { product: Product }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-fg-secondary">
      <span className="truncate" dir="auto">{product.supplier_name}</span>
      {product.supplier_verified ? (
        <span className="shrink-0 text-success" title={t("commerce.catalog.verifiedSupplier")}>
          <BadgeCheckIcon size={13} />
        </span>
      ) : null}
    </span>
  );
}

function GridCard({ product, orgId, saved, image }: { product: Product; orgId: string; saved: boolean; image: string | null }) {
  const { t } = useI18n();
  const { meta, colors } = useMeta(product);
  return (
    <div className="group flex h-full flex-col gap-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:p-sm" data-testid="showroom-catalog-card">
      <div className="relative">
        <ProductMedia src={image} alt={product.name ?? ""} aspect="aspect-[4/3] tablet:aspect-[16/9]" />
        <span className="absolute start-1.5 top-1.5 max-w-[calc(100%-3.5rem)]">
          <Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge>
        </span>
        <span className="absolute end-1.5 top-1.5">
          <SaveProductButton orgId={orgId} productId={product.id} saved={saved} compact />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link href={detailHref(product.id)} className="line-clamp-2 w-full text-body font-medium leading-snug text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" dir="auto">
          {product.name}
        </Link>
        {product.sku ? <p className="w-full truncate text-label text-fg-muted" data-testid="card-code"><span>{t("showroomProducts.code")}: </span><span dir="ltr">{product.sku}</span></p> : null}
        <SwatchRow colors={colors} />
        {meta ? <p className="w-full text-label text-fg-muted" dir="auto" data-testid="card-meta">{meta}</p> : null}
        <div className="mt-auto w-full border-t pt-2 text-label">
          <Supplier product={product} />
        </div>
      </div>
    </div>
  );
}

function ListRow({ product, orgId, saved, image }: { product: Product; orgId: string; saved: boolean; image: string | null }) {
  const { t } = useI18n();
  const { meta, colors } = useMeta(product);
  return (
    <div className="group flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:flex-nowrap tablet:p-sm" data-testid="showroom-catalog-row">
      <Link href={detailHref(product.id)} className="flex min-w-0 flex-1 basis-[calc(100%-3.5rem)] items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:basis-auto">
        <div className="w-16 shrink-0 tablet:w-20">
          <ProductMedia src={image} alt={product.name ?? ""} aspect="aspect-square" />
        </div>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-body font-medium leading-snug text-fg group-hover:text-accent" dir="auto">{product.name}</span>
          {product.sku ? <span className="truncate text-label text-fg-muted" dir="ltr" data-testid="card-code">{product.sku}</span> : null}
        </span>
      </Link>
      <span className="order-last flex w-full min-w-0 items-center gap-x-sm text-label tablet:order-none tablet:w-auto tablet:gap-x-md">
        <span className="shrink-0"><Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge></span>
        <span className="flex min-w-0 flex-1 tablet:w-52 tablet:flex-none"><Supplier product={product} /></span>
        <span className="min-w-0 truncate text-fg-muted tablet:w-44" dir="auto" data-testid="card-meta">{meta}</span>
        <SwatchRow colors={colors} max={4} />
      </span>
      <SaveProductButton orgId={orgId} productId={product.id} saved={saved} compact />
      <Link
        href={detailHref(product.id)}
        className="order-last inline-flex h-9 w-full shrink-0 items-center justify-center rounded-sm tablet:w-auto border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:order-none"
      >
        {t("showroomCatalog.viewDetails")}
      </Link>
    </div>
  );
}
