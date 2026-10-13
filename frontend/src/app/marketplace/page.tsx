import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarketplaceBrowser } from "@/features/marketplace/marketplace-browser";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace | Aladdin",
  robots: { index: false, follow: false },
};

/**
 * Marketplace UI preview (ADR-0011) — SAMPLE DATA, no cart/checkout/payment.
 * Closed unless NEXT_PUBLIC_MARKETPLACE_PREVIEW="true"; otherwise a plain 404, so
 * Production exposes nothing until the release flag is set on purpose.
 */
export default async function MarketplacePage() {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell>
        <Suspense fallback={null}>
          <MarketplaceBrowser />
        </Suspense>
      </MarketplaceShell>
    </I18nProvider>
  );
}
