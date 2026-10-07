import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { listOwnProducts, ownProductCounts } from "@/server/queries/commerce";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { StatePanel } from "@/components/ui/primitives";
import { BadgeCheckIcon, InboxIcon, PackageIcon, PencilIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero, MY_PRODUCTS_HERO_ART } from "@/features/showroom-shell/page-hero";
import { parseMyProductsParams, statusFilterToQuery, type MyProductsStatusFilter } from "./my-products-params";
import { OwnProductsResults, type OwnProductCard } from "./own-products-results";
import { ProductStatCards } from "./stat-cards";
import { MyProductsToolbar } from "./my-products-toolbar";
import { CategoryChips } from "./category-chips";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const BASE_PATH = `${SHOWROOM_ROOT}/my-products`;

/**
 * منتجاتي — the products OWNED by the active organization (drafts and archived
 * ones included), through the caller's own RLS. Composition follows the approved
 * reference (hero, four summary cards, toolbar, category chips, product cards);
 * data and rules are the real domain: public visibility is still decided by the
 * existing published-product rules, and "active" means exactly "published".
 */
export async function ShowroomMyProducts({
  ctx,
  locale,
  searchParams,
}: {
  ctx: Ctx;
  locale: Locale;
  searchParams: { q?: string; category?: string; status?: string; sort?: string };
}) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  const params = parseMyProductsParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);

  const [rows, counts] = await Promise.all([
    listOwnProducts(supabase, org.organizationId, { search: params.q, categoryCode: params.category, sort: params.sort, ...statusFilterToQuery(params.status) }),
    ownProductCounts(supabase, org.organizationId),
  ]);

  const images = await listProductImages(supabase, rows.map((r) => r.id));
  const primaryKeys = rows.map((r) => images.get(r.id)?.[0]?.objectKey ?? null);
  const signed = await signProductImageUrls(supabase, primaryKeys);

  const cards: OwnProductCard[] = rows.map((r) => {
    const key = images.get(r.id)?.[0]?.objectKey;
    return {
      id: r.id,
      name: r.name,
      code: r.sku,
      categoryCode: r.category_code,
      unit: r.unit,
      status: r.status,
      archivedAt: r.archived_at,
      version: r.version,
      imageUrl: (key ? signed.get(key) : undefined) ?? r.image_ref ?? null,
      sizeLabel: r.size_label,
      weightKg: r.weight_kg,
      colors: r.colors,
    };
  });

  const filtered = Boolean(params.q || params.category || params.status);
  const href = (patch: { status?: MyProductsStatusFilter | ""; category?: string }) => {
    const next = new URLSearchParams();
    const status = patch.status === undefined ? params.status : patch.status || undefined;
    const category = patch.category === undefined ? params.category : patch.category || undefined;
    if (params.q) next.set("q", params.q);
    if (category) next.set("category", category);
    if (status) next.set("status", status);
    if (params.sort !== "updated") next.set("sort", params.sort);
    const qs = next.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  };

  // Latin digits on purpose: in the Arabic display face "٥" reads as a zero (and "٠" as a dot), which made a count of five look like "0 products". The reference uses Latin figures too.
  const num = (n: number) => String(n);
  const viewAll = t("showroomProducts.viewAll");
  const stats = [
    { key: "total", label: t("showroomProducts.stats.total"), value: num(counts.total + counts.archived), href: href({ status: "" }), active: !params.status, viewAll, Icon: PackageIcon },
    { key: "active", label: t("showroomProducts.stats.active"), value: num(counts.published), href: href({ status: "active" }), active: params.status === "active", viewAll, Icon: BadgeCheckIcon },
    { key: "draft", label: t("showroomProducts.stats.draft"), value: num(counts.draft), href: href({ status: "inactive" }), active: params.status === "inactive", viewAll, Icon: PencilIcon },
    { key: "archived", label: t("showroomProducts.stats.archived"), value: num(counts.archived), href: href({ status: "archived" }), active: params.status === "archived", viewAll, Icon: InboxIcon },
  ];
  const chips = [
    { value: "", label: t("showroomProducts.chipAll") },
    ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: m.commerce.canonicalCategories[c] })),
  ];

  return (
    <div className="flex flex-col gap-md" data-testid="my-products">
      <ShowroomPageHero locale={locale} title={t("showroomProducts.title")} subtitle={t("showroomProducts.heroSubtitle")} Icon={PackageIcon} titleId="my-products-title" art={MY_PRODUCTS_HERO_ART} />
      {!canWrite ? <p className="text-label text-fg-muted" data-testid="my-products-readonly">{t("showroomProducts.readOnlyNote")}</p> : null}

      <ProductStatCards stats={stats} />

      <MyProductsToolbar basePath={BASE_PATH} q={params.q ?? ""} category={params.category ?? ""} sort={params.sort} canCreate={canWrite} />
      <CategoryChips chips={chips} selected={params.category ?? ""} hrefFor={(value) => href({ category: value })} label={t("showroomProducts.category")} />

      {cards.length === 0 ? (
        <StatePanel
          icon={<PackageIcon size={22} />}
          title={filtered ? t("showroomProducts.noResultsTitle") : t("showroomProducts.emptyTitle")}
          body={filtered ? t("showroomProducts.noResultsBody") : t("showroomProducts.emptyBody")}
          action={
            filtered ? (
              <Link href={BASE_PATH} className="text-label font-medium text-accent hover:underline">{t("showroomProducts.clearFilters")}</Link>
            ) : canWrite ? (
              <Link href={`${BASE_PATH}/new`} className="text-label font-medium text-accent hover:underline">{t("showroomProducts.create")}</Link>
            ) : undefined
          }
        />
      ) : (
        <OwnProductsResults
          products={cards}
          initialView={view}
          countLabel={t("showroomProducts.count", { count: String(cards.length) })}
          canWrite={canWrite}
          canPublish={canPublish}
        />
      )}
    </div>
  );
}
