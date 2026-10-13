import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MarketplaceProductDetail } from "@/features/marketplace/marketplace-product-detail";
import { findPreviewProduct } from "@/features/marketplace/marketplace-preview-data";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace product | Aladdin",
  robots: { index: false, follow: false },
};

export default async function MarketplaceProductPage({ params }: { params: Promise<{ slug: string }> }) {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const { slug } = await params;
  const product = findPreviewProduct(slug);
  if (!product) notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <MarketplaceProductDetail product={product} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
