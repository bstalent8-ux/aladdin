import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { listCatalog, savedProductIds } from "@/server/queries/commerce";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { SearchIcon, StorefrontIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { resolveProductImage, signProductImageUrls } from "@/server/queries/product-images";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { CATALOG_MAX_LIMIT, CATALOG_PAGE_SIZE, parseShowroomCatalogParams } from "./catalog-params";
import { CatalogResults } from "./catalog-results";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const BASE_PATH = `${SHOWROOM_ROOT}/catalog`;

/**
 * تصفح المنتجات — the showroom's view of the production catalog.
 *
 * Nothing here is a second catalog: the rows come from `listCatalog` (the
 * RLS-scoped `catalog_published_products` view, published products only) and the
 * save state from `savedProductIds`, both through the CALLER's own client. This
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
  searchParams: { q?: string; category?: string; supplier?: string; limit?: string };
}) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const params = parseShowroomCatalogParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);

  const [products, saved] = await Promise.all([
    listCatalog(supabase, { search: params.q, categoryCode: params.category, supplierOrgId: params.supplier, excludeOrgId: org.organizationId, limit: params.limit }),
    savedProductIds(supabase, org.organizationId),
  ]);

  // Uploaded primary photos are private objects: sign them with the caller's own access,
  // falling back to the legacy image reference (or the placeholder) per product.
  const signed = await signProductImageUrls(supabase, products.map((p) => p.primary_image_key));
  const imageUrls: Record<string, string> = {};
  for (const p of products) {
    const url = p.id ? resolveProductImage(p, signed) : null;
    if (p.id && url) imageUrls[p.id] = url;
  }

  const filtered = Boolean(params.q || params.category || params.supplier);
  const supplierName = params.supplier ? (products[0]?.supplier_name ?? null) : null;
  const mayHaveMore = products.length >= params.limit && params.limit < CATALOG_MAX_LIMIT;
  const moreHref = (() => {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    if (params.category) next.set("category", params.category);
    if (params.supplier) next.set("supplier", params.supplier);
    next.set("limit", String(params.limit + CATALOG_PAGE_SIZE));
    return `${BASE_PATH}?${next.toString()}`;
  })();

  return (
    <div className="flex flex-col gap-md" data-testid="showroom-catalog">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t("showroomCatalog.title")}
        subtitle={supplierName ? t("showroomCatalog.scopedTo", { name: supplierName }) : t("showroomCatalog.subtitle")}
      />
      <FilterBar
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
        <>
          <CatalogResults
            products={products}
            orgId={org.organizationId}
            savedIds={[...saved]}
            initialView={view}
            countLabel={t("showroomCatalog.count", { count: products.length })}
            imageUrls={imageUrls}
          />
          {mayHaveMore ? (
            <div className="flex flex-col items-center gap-2 pt-sm">
              <p className="text-label text-fg-muted">{t("showroomCatalog.limitNote", { count: products.length })}</p>
              <Link
                href={moreHref}
                className="inline-flex h-9 items-center rounded-sm border border-strong px-4 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {t("showroomCatalog.showMore")}
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
