"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { type CatalogView } from "@/lib/ui/catalog-view";
import { Pager } from "@/components/ui/pager";
import { type PagedLoad } from "@/lib/pagination/batches";
import { usePagedList } from "@/lib/pagination/use-paged-list";
import { loadShowroomSavedBatchAction } from "@/server/actions/showroom-saved-feed";
import type { CatalogRow } from "@/server/queries/commerce";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { GridCard, ListRow, isRenderable, type Product } from "@/features/showroom-shell/catalog/product-cards";

/**
 * The shortlist, drawn with the SAME cards as Browse products. Every card here is saved by definition;
 * un-saving from a card removes it in place (and the total shrinks) without a page reload.
 */
export function SavedResults({
  products,
  total,
  filters,
  orgId,
  initialView,
  imageUrls: initialImageUrls = {},
}: {
  /** The FIRST batch (server-rendered); further batches are bounded server reads. */
  products: CatalogRow[];
  total: number;
  filters: { q?: string; category?: string };
  imageUrls?: Record<string, string>;
  orgId: string;
  initialView: CatalogView;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const [imageUrls, setImageUrls] = useState(initialImageUrls);

  const load = useCallback<PagedLoad<Product>>(
    async (offset) => {
      const res = await loadShowroomSavedBatchAction(filters, offset);
      if (!res.ok) return null;
      setImageUrls((prev) => ({ ...prev, ...res.imageUrls }));
      return { items: res.products.filter(isRenderable), total: res.total };
    },
    [filters],
  );
  const list = usePagedList(products.filter(isRenderable), total, load);
  const unsaved = (id: string) => (next: boolean) => {
    if (!next) list.remove(id);
  };

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomSaved.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted" data-testid="showroom-saved-count">{t("showroomSaved.count", { count: String(list.total) })}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="showroom-saved" />
      </div>

      {list.items.length === 0 ? (
        <p className="rounded-md border bg-surface p-lg text-center text-body text-fg-secondary" data-testid="showroom-saved-emptied">{t("showroomSaved.emptyTitle")}</p>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4 wide:grid-cols-5" data-testid="showroom-saved-grid">
          {list.items.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} orgId={orgId} saved image={imageUrls[p.id] ?? p.image_ref} onSavedChange={unsaved(p.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="showroom-saved-list">
          {list.items.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} orgId={orgId} saved image={imageUrls[p.id] ?? p.image_ref} onSavedChange={unsaved(p.id)} />
            </li>
          ))}
        </ul>
      )}
      <Pager shown={list.items.length} total={list.total} loading={list.loading} failed={list.failed} onMore={() => void list.more()} onLess={list.less} testId="showroom-saved" />
    </section>
  );
}
