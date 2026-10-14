import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LiveCatalog, type CatalogParams } from "@/features/marketplace/live/live-catalog";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { PUBLIC_SORTS, loadPublicCatalogPage, loadPublicFacets, type PublicSort } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace | Aladdin",
  robots: { index: false, follow: false },
};

const KEY = /^[a-z0-9_]{1,64}$/;

/**
 * Public Marketplace catalog — REAL data only (Migration 09 public RPCs):
 * published products of approved sellers, server-side search/filter/pagination.
 * No sample products and no purchase. Still closed unless
 * NEXT_PUBLIC_MARKETPLACE_PREVIEW="true", so Production exposes nothing until
 * the release flag is set on purpose.
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; type?: string; q?: string; sort?: string; page?: string }>;
}) {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const sp = await searchParams;
  const params: CatalogParams = {
    category: KEY.test(sp.category ?? "") ? sp.category! : "",
    type: KEY.test(sp.type ?? "") ? sp.type! : "",
    q: (sp.q ?? "").trim().slice(0, 100),
    sort: (PUBLIC_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as PublicSort) : "newest",
    page: Math.min(10000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)),
  };
  const [page, facets] = await Promise.all([loadPublicCatalogPage(params), loadPublicFacets()]);
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell live>
        <LiveCatalog locale={locale} params={params} page={page} facets={facets} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
