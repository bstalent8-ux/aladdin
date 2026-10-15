import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getOfferDetail, listRelatedOffers, signOfferImages } from "@/server/queries/offers";
import { StatePanel } from "@/components/ui/primitives";
import { TagIcon } from "@/components/ui/icons";
import { OfferDetailView } from "@/features/offers/offer-detail-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One offer for a personal account; offer_detail matches the caller's own persona. */
export default async function PersonalOfferDetailPage({ params }: { params: Promise<{ offerId: string }> }) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  const { offerId } = await params;
  if (!UUID.test(offerId)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  const offer = await getOfferDetail(supabase, null, offerId);
  if (!offer) {
    return (
      <StatePanel
        icon={<TagIcon size={22} />}
        title={t("showroomOffers.detail.notAvailableTitle")}
        body={t("showroomOffers.detail.notAvailableBody")}
        action={<Link href="/home/offers" className="text-label font-medium text-accent hover:underline">{t("showroomOffers.detail.back")}</Link>}
      />
    );
  }
  const others = await listRelatedOffers(supabase, null, offer.id);
  const imageUrls = await signOfferImages(supabase, null, [offer, ...others]);
  return (
    <OfferDetailView
      offer={offer}
      imageUrls={imageUrls}
      related={others}
      locale={locale}
      t={t}
      canRfq={false}
      showRfq={false}
      orgId={null}
      rfqHref="/home/offers"
      backHref="/home/offers"
      feedHref="/home/offers"
      detailBase="/home/offers"
    />
  );
}
