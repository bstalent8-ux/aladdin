"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { CatalogView } from "@/lib/ui/catalog-view";
import { Badge } from "@/components/ui/primitives";
import { ProductMedia } from "@/features/commerce/product-media";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { LifecycleControls } from "./lifecycle-controls";
import { ownCategoryLabel } from "./labels";
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
  colorCount: number;
};

const TONE: Record<OwnProductStatus, "success" | "warning" | "neutral"> = { active: "success", inactive: "warning", archived: "neutral" };
const editHref = (id: string) => `${SHOWROOM_ROOT}/my-products/${id}/edit`;

/**
 * The management view of the organization's own products: the same Grid / List
 * toggle and cookie as Browse products, but each product carries its status and
 * the lifecycle controls — this is not the public catalog, so management actions
 * belong here. (The public card stays in the catalog; the two have different jobs.)
 */
export function OwnProductsResults({
  products,
  initialView,
  countLabel,
  canWrite,
  canPublish,
}: {
  products: OwnProductCard[];
  initialView: CatalogView;
  countLabel: string;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomProducts.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted" data-testid="my-products-count">{countLabel}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="my-products" />
      </div>
      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4" data-testid="my-products-grid">
          {products.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} canWrite={canWrite} canPublish={canPublish} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="my-products-list">
          {products.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} canWrite={canWrite} canPublish={canPublish} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: OwnProductStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`showroomProducts.status.${status}`)}</Badge>;
}

function GridCard({ product, canWrite, canPublish }: { product: OwnProductCard; canWrite: boolean; canPublish: boolean }) {
  const { t } = useI18n();
  const status = ownProductStatus({ status: product.status, archived_at: product.archivedAt });
  return (
    <div className={cn("flex h-full flex-col gap-2 rounded-md border bg-surface p-2 tablet:p-sm", status === "archived" && "opacity-80")} data-testid="my-products-card" data-status={status}>
      <Link href={editHref(product.id)} className="relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label={product.name}>
        <ProductMedia src={product.imageUrl} alt={product.name} aspect="aspect-[4/3] tablet:aspect-[16/10]" />
        <span className="absolute start-1.5 top-1.5"><StatusBadge status={status} /></span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={editHref(product.id)} className="line-clamp-2 w-full text-body font-medium leading-snug text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" dir="auto">
          {product.name}
        </Link>
        {product.code ? <p className="w-full truncate text-label text-fg-muted" dir="ltr">{product.code}</p> : null}
        <p className="flex w-full flex-col text-label text-fg-secondary tablet:flex-row tablet:justify-between tablet:gap-2">
          <span className="truncate">{ownCategoryLabel(t, { category_code: product.categoryCode })}</span>
          <span className="shrink-0 text-fg-muted">{t(`commerce.units.${product.unit}`)}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-1.5 border-t pt-2">
        {canWrite && status !== "archived" ? (
          <Link href={editHref(product.id)} className="inline-flex min-h-8 items-center rounded-sm border border-strong px-3 text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {t("showroomProducts.edit")}
          </Link>
        ) : null}
        <LifecycleControls productId={product.id} version={product.version} status={status} canWrite={canWrite} canPublish={canPublish} />
      </div>
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
        <span className="shrink-0 text-fg-muted tablet:w-24">{t(`commerce.units.${product.unit}`)}</span>
      </span>
      <div className="flex flex-wrap items-start gap-1.5">
        {canWrite && status !== "archived" ? (
          <Link href={editHref(product.id)} className="inline-flex min-h-8 items-center rounded-sm border border-strong px-3 text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {t("showroomProducts.edit")}
          </Link>
        ) : null}
        <LifecycleControls productId={product.id} version={product.version} status={status} canWrite={canWrite} canPublish={canPublish} />
      </div>
    </div>
  );
}
