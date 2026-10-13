import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MarketplaceCartPage } from "@/features/marketplace/marketplace-cart-page";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cart | Aladdin Marketplace",
  robots: { index: false, follow: false },
};

/** Guest cart preview (ADR-0011) — SAMPLE data, no checkout/payment; closed unless the preview flag is on. */
export default async function MarketplaceCartRoute() {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell>
        <MarketplaceCartPage />
      </MarketplaceShell>
    </I18nProvider>
  );
}
