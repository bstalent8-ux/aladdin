import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { listOwnProducts, ownProductCounts } from "@/server/queries/commerce";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { PackageIcon, StorefrontIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { cn } from "@/lib/ui/cn";
import { MY_PRODUCTS_STATUSES, parseMyProductsParams, statusFilterToQuery } from "./my-products-params";
import { OwnProductsResults, type OwnProductCard } from "./own-products-results";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const BASE_PATH = `${SHOWROOM_ROOT}/my-products`;

/**
 * منتجاتي — the products OWNED by the active organization (drafts and archived
 * ones included), through the caller's own RLS. This is the management view, not
 * the public catalog: public visibility is still decided by the existing
 * published-product rules, and "active" here means exactly "published".
 */
export async function ShowroomMyProducts({
  ctx,
  locale,
  searchParams,
}: {
  ctx: Ctx;
  locale: Locale;
  searchParams: { q?: string; category?: string; status?: string };
}) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  const params = parseMyProductsParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);

  const [rows, counts] = await Promise.all([
    listOwnProducts(supabase, org.organizationId, { search: params.q, categoryCode: params.category, ...statusFilterToQuery(params.status) }),
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
      colorCount: r.colors.length,
    };
  });

  const filtered = Boolean(params.q || params.category || params.status);
  const tabCounts: Record<(typeof MY_PRODUCTS_STATUSES)[number], number> = {
    active: counts.published,
    inactive: counts.draft,
    archived: counts.archived,
  };
  const tabHref = (status?: string) => {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    if (params.category) next.set("category", params.category);
    if (status) next.set("status", status);
    const qs = next.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  };

  return (
    <div className="flex flex-col gap-md" data-testid="my-products">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t("showroomProducts.title")}
        subtitle={t("showroomProducts.subtitle")}
        action={canWrite ? { href: `${BASE_PATH}/new`, label: t("showroomProducts.create") } : undefined}
      />
      {!canWrite ? <p className="text-label text-fg-muted" data-testid="my-products-readonly">{t("showroomProducts.readOnlyNote")}</p> : null}

      <nav aria-label={t("showroomProducts.title")} className="flex flex-wrap gap-1.5" data-testid="my-products-tabs">
        <TabLink href={tabHref()} active={!params.status} label={`${t("showroomProducts.statusAll")} (${counts.total + counts.archived})`} />
        {MY_PRODUCTS_STATUSES.map((s) => (
          <TabLink key={s} href={tabHref(s)} active={params.status === s} label={`${t(`showroomProducts.summary.${s}`)} (${tabCounts[s]})`} />
        ))}
      </nav>

      <FilterBar
        basePath={BASE_PATH}
        search={{ name: "q", value: params.q ?? "", placeholder: t("showroomProducts.searchPlaceholder") }}
        selects={[
          {
            name: "category",
            label: t("showroomProducts.category"),
            value: params.category ?? "",
            anyLabel: t("showroomProducts.allCategories"),
            options: [
              ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: m.commerce.canonicalCategories[c] })),
              { value: "unclassified", label: t("showroomProducts.unclassified") },
            ],
          },
        ]}
        clearLabel={t("showroomProducts.clearFilters")}
      />

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
          countLabel={t("showroomProducts.count", { count: cards.length })}
          canWrite={canWrite}
          canPublish={canPublish}
        />
      )}
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-8 items-center rounded-pill border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        active ? "border-transparent bg-primary text-primary-foreground" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
      )}
    >
      {label}
    </Link>
  );
}
