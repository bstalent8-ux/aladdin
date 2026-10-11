import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listOffersPage, signOfferImages } from "@/server/queries/offers";
import { HomeHeader } from "@/features/home/parts";
import { OffersFeedView } from "@/features/offers/offers-feed-view";

export const dynamic = "force-dynamic";

/**
 * العروض for a personal account (engineer, interior designer, craftsman, contractor, end
 * customer). A thin adapter over the shared feed: with no workspace given, the database matches
 * the caller's own persona against each offer's audiences.
 */
export default async function PersonalOffersPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();
  const page = await listOffersPage(supabase, null);
  const imageUrls = await signOfferImages(supabase, null, page.items);
  return (
    <div className="flex flex-col gap-md" data-testid="personal-offers">
      <HomeHeader eyebrow={t("showroomOffers.feed.badge")} title={t("showroomOffers.feed.title")} lead={t("showroomOffers.feed.subtitle")} />
      <OffersFeedView
        initialPage={page}
        initialImageUrls={imageUrls}
        orgId={null}
        locale={locale}
        initialView={resolveCatalogView(store.get(CATALOG_VIEW_COOKIE)?.value)}
        detailBase="/home/offers"
      />
    </div>
  );
}
