"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { CatalogView } from "@/lib/ui/catalog-view";
import { Badge } from "@/components/ui/primitives";
import { CameraIcon, PencilIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { ActiveSwitch, ArchiveAction, RestoreAction } from "./lifecycle-controls";
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
  weightKg: number | null;
  colors: string[];
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

/** "Basic metadata" line of the reference: unit • size • weight, only what the product has. */
function metaLine(t: (k: string) => string, p: OwnProductCard) {
  return [t(`commerce.units.${p.unit}`), p.sizeLabel, p.weightKg !== null ? `${p.weightKg} ${t("showroomProducts.kg")}` : null].filter(Boolean).join(" • ");
}

function ColorChips({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1" data-testid="card-colors">
      {colors.slice(0, 3).map((c) => (
        <li key={c} className="max-w-full truncate rounded-pill bg-surface-2 px-2 py-0.5 text-caption text-fg-secondary" dir="auto">{c}</li>
      ))}
      {colors.length > 3 ? <li className="rounded-pill bg-surface-2 px-2 py-0.5 text-caption text-fg-muted" dir="ltr">+{colors.length - 3}</li> : null}
    </ul>
  );
}

const actionLink =
  "inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-sm border border-strong px-2 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function CardActions({ product, status, canWrite }: { product: OwnProductCard; status: OwnProductStatus; canWrite: boolean }) {
  const { t } = useI18n();
  const edit = editHref(product.id);
  if (status === "archived") {
    return canWrite ? <div className="flex flex-wrap items-start gap-1.5"><RestoreAction productId={product.id} version={product.version} /></div> : null;
  }
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {canWrite ? (
        <>
          <Link href={edit} className={actionLink}><PencilIcon size={14} /><span className="sr-only tablet:not-sr-only">{t("showroomProducts.edit")}</span></Link>
          <Link href={`${edit}#product-photos`} className={actionLink}><CameraIcon size={14} /><span className="sr-only tablet:not-sr-only">{t("showroomProducts.manageImages")}</span></Link>
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
        <ProductMedia src={product.imageUrl} alt={product.name} aspect="aspect-[4/3] tablet:aspect-[16/10]" />
        <span className="absolute start-1.5 top-1.5 rounded-pill bg-surface"><StatusBadge status={status} /></span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link href={editHref(product.id)} className="line-clamp-2 w-full text-body font-semibold leading-snug text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" dir="auto">
          {product.name}
        </Link>
        {product.code ? <p className="w-full truncate text-label text-fg-muted"><span>{t("showroomProducts.code")}: </span><span dir="ltr">{product.code}</span></p> : null}
        <span className="w-fit max-w-full truncate rounded-sm bg-accent-solid/15 px-2 py-0.5 text-label font-medium text-accent">{ownCategoryLabel(t, { category_code: product.categoryCode })}</span>
        <ColorChips colors={product.colors} />
        <p className="w-full text-label text-fg-muted" dir="auto">{metaLine(t, product)}</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        {canPublish && status !== "archived" ? <ActiveSwitch productId={product.id} version={product.version} active={status === "active"} /> : <span />}
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
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && status !== "archived" ? <ActiveSwitch productId={product.id} version={product.version} active={status === "active"} /> : null}
        <CardActions product={product} status={status} canWrite={canWrite} />
      </div>
    </div>
  );
}
