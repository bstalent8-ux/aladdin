"use client";

import type { ReactNode } from "react";
import { LandingFooter } from "@/features/landing-preview/landing-footer";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import { useI18n } from "@/lib/i18n/context";
import { MarketplaceCartProvider, useMarketplaceCart } from "./marketplace-cart";
import { marketplaceCopy } from "./marketplace-copy";
import brand from "@/styles/brand-2026.module.css";
import styles from "./marketplace.module.css";

/** Slim page frame for the Marketplace preview surfaces (bar, title, preview note, footer). */
export function MarketplaceShell({ children }: { children: ReactNode; showTitle?: boolean }) {
  return (
    <MarketplaceCartProvider>
      <ShellFrame>{children}</ShellFrame>
    </MarketplaceCartProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { locale, dir } = useI18n();
  const t = marketplaceCopy[locale];
  const cart = useMarketplaceCart();
  return (
    <div className={`${brand.brand} ${styles.page}`} dir={dir} data-marketplace-preview="true">
      <div className={styles.container}>
        <div className={styles.headerSlot}><LandingHeader anchorBase="/" showCart cartCount={cart.count} active="marketplace" /></div>
      </div>
      <main className={styles.container}>
        <p className={styles.previewChip}>{t.previewChip}</p>
        {children}
        <p className={styles.previewNote}>{t.previewNote}</p>
      </main>
      <LandingFooter anchorBase="/" />
    </div>
  );
}
