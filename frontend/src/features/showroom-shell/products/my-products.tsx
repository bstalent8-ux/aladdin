import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { ownProductCounts } from "@/server/queries/commerce";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import { StatePanel } from "@/components/ui/primitives";
import { BadgeCheckIcon, InboxIcon, PackageIcon, PencilIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero, MY_PRODUCTS_HERO_ART } from "@/features/showroom-shell/page-hero";
import { parseMyProductsParams, type MyProductsStatusFilter } from "./my-products-params";
import { OwnProductsResults } from "./own-products-results";
import { loadMyProductsBatch } from "./my-products-data";
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

  // First batch only; "Show more" reads the next one. The status tabs count the WHOLE shelf, not this batch.
  const [{ cards, total }, counts] = await Promise.all([
    loadMyProductsBatch(supabase, org.organizationId, params, 0, PAGE_BATCH),
    ownProductCounts(supabase, org.organizationId),
  ]);
  // A lifecycle change re-renders this page with fresh rows: the list restarts from them (new key).
  const listKey = `${params.q ?? ""}|${params.category ?? ""}|${params.status ?? ""}|${params.sort}|${cards.map((c) => `${c.id}.${c.version}.${c.archivedAt ? 1 : 0}`).join(",")}`;

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
          key={listKey}
          products={cards}
          total={total}
          filters={{ q: params.q, category: params.category, status: params.status, sort: params.sort }}
          initialView={view}
          canWrite={canWrite}
          canPublish={canPublish}
        />
      )}
    </div>
  );
}
