import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { directionFor } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The showroom suite's page header: an optional artwork strip with the title block
 * beside it, the same composition the Craftsman pages use (artwork on one side, the
 * title on a clean panel on the other, collapsing to a short strip above the title
 * on phones). Artwork is a PRODUCTION ASSET supplied per page; a page without one
 * simply shows the title block on the surface — never a stand-in image.
 */
export type PageHeroArt = { light: string; dark: string };

export function ShowroomPageHero({
  locale,
  title,
  subtitle,
  Icon,
  art,
  back,
  titleId = "page-title",
}: {
  locale: Locale;
  title: string;
  subtitle?: string;
  Icon?: ComponentType<{ size?: number }>;
  art?: PageHeroArt;
  /** A back link rendered above the title (create / edit screens). */
  back?: ReactNode;
  titleId?: string;
}) {
  const dir = directionFor(locale);
  return (
    <section aria-labelledby={titleId} className="relative isolate overflow-hidden rounded-lg border border-strong bg-surface" data-testid="page-hero">
      <div dir="ltr" className={cn("relative flex flex-col", art && "tablet:block tablet:min-h-44 desktop:min-h-48")}>
        {art ? (
          <div className="relative h-28 tablet:absolute tablet:inset-0 tablet:h-auto" aria-hidden="true">
            <Image src={art.light} alt="" fill priority sizes="100vw" className="object-cover object-left dark:hidden" />
            <Image src={art.dark} alt="" fill priority sizes="100vw" className="hidden object-cover object-left dark:block" />
          </div>
        ) : null}
        <div
          dir={dir}
          className={cn(
            "relative z-raised flex min-w-0 flex-col gap-1.5 px-md py-md tablet:px-xl",
            art && "tablet:absolute tablet:inset-y-0 tablet:right-0 tablet:w-[52%] tablet:justify-center",
          )}
        >
          {back}
          <h1 id={titleId} className="flex min-w-0 items-center gap-2.5 text-title font-bold tracking-tight text-fg tablet:text-headline desktop:text-display">
            {Icon ? <span className="text-accent"><Icon size={28} /></span> : null}
            <span className="min-w-0">{title}</span>
          </h1>
          {subtitle ? <p className="text-label leading-relaxed text-fg-secondary tablet:text-body-lg">{subtitle}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** My Products header artwork (production assets, panel on the right in both locales). */
export const MY_PRODUCTS_HERO_ART: PageHeroArt = {
  light: "/images/showroom/products/my-products-hero-light.png",
  dark: "/images/showroom/products/my-products-hero-dark.png",
};
