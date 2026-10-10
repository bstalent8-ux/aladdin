import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { SearchIcon, StorefrontIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { parseShowroomCatalogParams } from "./catalog-params";
import { loadCatalogBatch } from "./catalog-data";
import { CatalogResults } from "./catalog-results";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const BASE_PATH = `${SHOWROOM_ROOT}/catalog`;

/**
 * تصفح المنتجات — the showroom's view of the production catalog.
 *
 * Nothing here is a second catalog: the rows come from `listCatalogPage` (the
 * RLS-scoped `catalog_published_products` view, published products only) and the
 * save state of the visible batch, both through the CALLER's own client. This
 * file only composes them into the suite shell: filters from the URL, the
 * remembered grid/list mode, and the empty / no-results states.
 */
export async function ShowroomCatalog({
  ctx,
  locale,
  searchParams,
}: {
  ctx: Ctx;
  locale: Locale;
  searchParams: { q?: string; category?: string; supplier?: string };
}) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const params = parseShowroomCatalogParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);

  // Only the FIRST batch is read here; "Show more" asks for the next one (a bounded range read).
  const batch = await loadCatalogBatch(supabase, org.organizationId, params, 0, PAGE_BATCH);
  const { products } = batch;

  const filtered = Boolean(params.q || params.category || params.supplier);
  const supplierName = params.supplier ? (products[0]?.supplier_name ?? null) : null;
  const filterKey = JSON.stringify([params.q ?? "", params.category ?? "", params.supplier ?? ""]);

  return (
    <div className="flex flex-col gap-md" data-testid="showroom-catalog">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t("showroomCatalog.title")}
        subtitle={supplierName ? t("showroomCatalog.scopedTo", { name: supplierName }) : t("showroomCatalog.subtitle")}
      />
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
      {params.supplier ? (
        <p className="text-label">
          <Link href={BASE_PATH} className="text-accent hover:underline">{t("showroomCatalog.clearSupplier")}</Link>
        </p>
      ) : null}

      {products.length === 0 ? (
        <StatePanel
          icon={<SearchIcon size={22} />}
          title={filtered ? t("showroomCatalog.noResultsTitle") : m.commerce.catalog.emptyTitle}
          body={filtered ? t("showroomCatalog.noResultsBody") : m.commerce.catalog.emptyBody}
          action={
            filtered ? (
              <Link href={BASE_PATH} className="text-label font-medium text-accent hover:underline">
                {t("showroomCatalog.clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CatalogResults
          key={filterKey}
          products={products}
          total={batch.total}
          filters={{ q: params.q, category: params.category, supplier: params.supplier }}
          orgId={org.organizationId}
          savedIds={batch.savedIds}
          initialView={view}
          imageUrls={batch.imageUrls}
        />
      )}
    </div>
  );
}
