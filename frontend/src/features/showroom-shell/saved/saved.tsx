import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { BookmarkIcon, SearchIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { parseShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";
import { loadSavedBatch } from "./saved-data";
import { SavedResults } from "./saved-results";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const BASE_PATH = `${SHOWROOM_ROOT}/saved`;

/**
 * المنتجات المحفوظة — the active organization's shortlist (the canonical save backend: `saved_products`
 * through RLS), with the Browse card language, live search and the shared bounded 10 / +10 / −10 paging.
 * Nothing priced is shown: a saved product is a bookmark that leads to a quote request.
 */
export async function ShowroomSaved({ ctx, locale, searchParams }: { ctx: Ctx; locale: Locale; searchParams: { q?: string; category?: string } }) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const params = parseShowroomCatalogParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);
  const batch = await loadSavedBatch(supabase, org.organizationId, params, 0, PAGE_BATCH);
  const filtered = Boolean(params.q || params.category);
  const filterKey = JSON.stringify([params.q ?? "", params.category ?? ""]);

  return (
    <div className="flex flex-col gap-md" data-testid="showroom-saved">
      <PageHeader locale={locale} Icon={BookmarkIcon} title={t("showroomSaved.title")} subtitle={t("showroomSaved.subtitle")} />
      <FilterBar
        liveSearch
        basePath={BASE_PATH}
        search={{ name: "q", value: params.q ?? "", placeholder: m.commerce.catalog.searchPlaceholder }}
        selects={[
          {
            name: "category",
            label: m.commerce.fields.category,
            value: params.category ?? "",
            anyLabel: m.commerce.catalog.allCategories,
            options: CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: m.commerce.canonicalCategories[c] })),
          },
        ]}
        clearLabel={t("showroomCatalog.clearFilters")}
      />
      {batch.products.length === 0 ? (
        <StatePanel
          icon={filtered ? <SearchIcon size={22} /> : <BookmarkIcon size={22} />}
          title={filtered ? t("showroomCatalog.noResultsTitle") : t("showroomSaved.emptyTitle")}
          body={filtered ? t("showroomCatalog.noResultsBody") : t("showroomSaved.emptyBody")}
          action={
            <Link href={filtered ? BASE_PATH : `${SHOWROOM_ROOT}/catalog`} className="text-label font-medium text-accent hover:underline" data-testid="showroom-saved-empty-action">
              {filtered ? t("showroomCatalog.clearFilters") : t("showroomSaved.browse")}
            </Link>
          }
        />
      ) : (
        <SavedResults key={filterKey} products={batch.products} total={batch.total} filters={{ q: params.q, category: params.category }} orgId={org.organizationId} initialView={view} imageUrls={batch.imageUrls} />
      )}
    </div>
  );
}
