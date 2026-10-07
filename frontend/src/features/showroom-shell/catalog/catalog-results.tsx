"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CATALOG_VIEW_COOKIE, type CatalogView } from "@/lib/ui/catalog-view";
import { Badge } from "@/components/ui/primitives";
import { BadgeCheckIcon, GridIcon, ListIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";

type Product = CatalogRow & { id: string; category: NonNullable<CatalogRow["category"]>; unit: NonNullable<CatalogRow["unit"]> };

/** A view row whose core fields are missing is not a product the UI can describe — same rule as the detail page. */
const isRenderable = (p: CatalogRow): p is Product => Boolean(p.id && p.category && p.unit);

function persistView(view: CatalogView) {
  try {
    document.cookie = `${CATALOG_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* a blocked cookie only means the choice is not remembered */
  }
}

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
}: {
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

  const choose = (next: CatalogView) => {
    setView(next);
    persistView(next);
  };

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomCatalog.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted" data-testid="showroom-catalog-count">{countLabel}</p>
        <div role="group" aria-label={t("showroomCatalog.display")} className="inline-flex rounded-sm border border-strong bg-surface p-0.5">
          <ToggleButton active={view === "grid"} label={t("showroomCatalog.grid")} onClick={() => choose("grid")} testId="showroom-catalog-view-grid">
            <GridIcon size={16} />
          </ToggleButton>
          <ToggleButton active={view === "list"} label={t("showroomCatalog.list")} onClick={() => choose("list")} testId="showroom-catalog-view-list">
            <ListIcon size={16} />
          </ToggleButton>
        </div>
      </div>

      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4" data-testid="showroom-catalog-grid">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} orgId={orgId} saved={saved.has(p.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="showroom-catalog-list">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} orgId={orgId} saved={saved.has(p.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ToggleButton({
  active,
  label,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        active ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-2",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
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

function GridCard({ product, orgId, saved }: { product: Product; orgId: string; saved: boolean }) {
  const { t } = useI18n();
  return (
    <div className="group flex h-full flex-col gap-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:p-sm" data-testid="showroom-catalog-card">
      <div className="relative">
        <ProductMedia src={product.image_ref} alt={product.name ?? ""} aspect="aspect-[4/3] tablet:aspect-[16/10]" />
        <span className="absolute start-1.5 top-1.5 max-w-[calc(100%-3.5rem)]">
          <Badge tone="neutral">{t(`commerce.categories.${product.category}`)}</Badge>
        </span>
        <span className="absolute end-1.5 top-1.5">
          <SaveProductButton orgId={orgId} productId={product.id} saved={saved} compact />
        </span>
      </div>
      <Link href={detailHref(product.id)} className="flex min-w-0 flex-1 flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <h3 className="line-clamp-2 w-full text-body font-medium leading-snug text-fg group-hover:text-accent" dir="auto">{product.name}</h3>
        {product.brand ? <p className="w-full truncate text-label text-fg-muted" dir="auto">{product.brand}</p> : null}
        <div className="mt-auto flex w-full flex-col gap-0.5 border-t pt-2 text-label tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-2">
          <Supplier product={product} />
          <span className="shrink-0 truncate text-fg-muted">{t(`commerce.units.${product.unit}`)}</span>
        </div>
      </Link>
    </div>
  );
}

function ListRow({ product, orgId, saved }: { product: Product; orgId: string; saved: boolean }) {
  const { t } = useI18n();
  return (
    <div className="group flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:flex-nowrap tablet:p-sm" data-testid="showroom-catalog-row">
      <Link href={detailHref(product.id)} className="flex min-w-0 flex-1 basis-[calc(100%-3.5rem)] items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:basis-auto">
        <div className="w-16 shrink-0 tablet:w-20">
          <ProductMedia src={product.image_ref} alt={product.name ?? ""} aspect="aspect-square" />
        </div>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-body font-medium leading-snug text-fg group-hover:text-accent" dir="auto">{product.name}</span>
          {product.brand ? <span className="truncate text-label text-fg-muted" dir="auto">{product.brand}</span> : null}
        </span>
      </Link>
      <span className="order-last flex w-full min-w-0 items-center gap-x-sm text-label tablet:order-none tablet:w-auto tablet:gap-x-md">
        <span className="shrink-0"><Badge tone="neutral">{t(`commerce.categories.${product.category}`)}</Badge></span>
        <span className="flex min-w-0 flex-1 tablet:w-52 tablet:flex-none"><Supplier product={product} /></span>
        <span className="shrink-0 text-fg-muted tablet:w-24">{t(`commerce.units.${product.unit}`)}</span>
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
