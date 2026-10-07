import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { getCatalogProduct, savedProductIds } from "@/server/queries/commerce";
import { CatalogProductDetail } from "@/features/commerce/catalog-product-detail";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { SaveProductButton } from "@/features/commerce/save-product-button";

export const dynamic = "force-dynamic";

/**
 * Thin adapter over the production product detail: the same RLS-scoped
 * `getCatalogProduct` and the same `CatalogProductDetail` card, wrapped in the
 * suite shell with a suite back link and the save toggle. An unpublished,
 * archived or foreign-private product is simply absent from the view, so it is a
 * 404 here exactly as it is on /b2b/catalog.
 */
export default async function ShowroomCatalogProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "catalog");
  if (!item || !canNavigate(item, org.capabilities)) notFound();

  const { productId } = await params;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);

  const [product, saved] = await Promise.all([getCatalogProduct(supabase, productId), savedProductIds(supabase, org.organizationId)]);
  if (!product || !product.id || !product.category || !product.unit || !product.organization_id) notFound();

  // The uploaded photos (RLS: a published product's ready images), signed with the caller's own access.
  const gallery = (await listProductImages(supabase, [product.id])).get(product.id) ?? [];
  const signed = await signProductImageUrls(supabase, gallery.map((g) => g.objectKey));
  const imageUrls = gallery.map((g) => signed.get(g.objectKey)).filter((u): u is string => Boolean(u));

  const isOwnOrg = product.organization_id === org.organizationId;
  const canRfq = org.canManageSales || org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");

  return (
    <CatalogProductDetail
      product={{ ...product, id: product.id, category: product.category, unit: product.unit, organization_id: product.organization_id }}
      m={m}
      imageUrls={imageUrls}
      isOwnOrg={isOwnOrg}
      canRfq={canRfq}
      /* Full RFQ pages arrive in a later phase; the production request flow is the working one today. */
      rfqHref={`/b2b/rfqs/new?product=${product.id}`}
      back={
        <Link href={`${SHOWROOM_ROOT}/catalog`} className="mb-md inline-flex items-center text-label text-fg-secondary hover:text-fg">
          <span aria-hidden="true" className="me-1 rtl:rotate-180">←</span>
          {t("showroomCatalog.detailBack")}
        </Link>
      }
      extra={<SaveProductButton orgId={org.organizationId} productId={product.id} saved={saved.has(product.id)} />}
    />
  );
}
