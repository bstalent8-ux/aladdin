import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { getOwnProduct } from "@/server/queries/commerce";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { Card, Badge } from "@/components/ui/primitives";
import { ProductForm } from "@/features/showroom-shell/products/product-form";
import { ImageManager } from "@/features/showroom-shell/products/image-manager";
import { LifecycleControls } from "@/features/showroom-shell/products/lifecycle-controls";
import { ownProductStatus } from "@/features/showroom-shell/products/product-input";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { PackageIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShowroomEditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; photos?: string }>;
}) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "my-products");
  if (!item || !canNavigate(item, org.capabilities)) notFound();

  const { productId } = await params;
  const sp = await searchParams;
  if (!UUID.test(productId)) notFound();
  // Owned by THIS organization, or it does not exist here — another tenant's product never opens.
  const product = await getOwnProduct(supabase, org.organizationId, productId);
  if (!product) notFound();

  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  const status = ownProductStatus(product);

  const images = (await listProductImages(supabase, [product.id])).get(product.id) ?? [];
  const signed = await signProductImageUrls(supabase, images.map((i) => i.objectKey));

  return (
    <div className="flex flex-col gap-md" data-testid="edit-product" data-status={status}>
      <ShowroomPageHero
        locale={locale}
        titleId="edit-product-title"
        Icon={PackageIcon}
        title={t("showroomProducts.editTitle")}
        subtitle={product.name}
        back={
          <Link href={`${SHOWROOM_ROOT}/my-products`} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span aria-hidden="true" className="rtl:rotate-180">←</span>
            {t("showroomProducts.backToList")}
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-x-md gap-y-2">
        <Badge tone={status === "active" ? "success" : status === "inactive" ? "warning" : "neutral"}>{t(`showroomProducts.status.${status}`)}</Badge>
        <LifecycleControls productId={product.id} version={product.version} status={status} canWrite={canWrite} canPublish={canPublish} />
      </div>

      {sp.created === "1" ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="created-note">{sp.photos === "partial" ? t("showroomProducts.createdPartial") : t("showroomProducts.created")}</p> : null}
      {sp.saved === "1" ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="saved-note">{t("showroomProducts.saved")}</p> : null}

      {status === "archived" ? (
        <p className="rounded-sm border bg-surface px-md py-2 text-body text-fg-secondary" data-testid="archived-note">{t("showroomProducts.errors.archived")}</p>
      ) : canWrite ? (
        <ProductForm
          orgId={org.organizationId}
          product={{
            id: product.id,
            version: product.version,
            name: product.name,
            code: product.sku,
            categoryCode: product.category_code,
            unit: product.unit,
            colors: product.colors,
            weightKg: product.weight_kg,
            sizeLabel: product.size_label,
            brand: product.brand,
            description: product.short_description,
          }}
        />
      ) : (
        <p className="text-label text-fg-muted">{t("showroomProducts.readOnlyNote")}</p>
      )}

      {canWrite ? (
        <div id="product-photos" className="scroll-mt-24">
        <Card className="max-w-3xl">
          <ImageManager
            productId={product.id}
            productName={product.name}
            archived={status === "archived"}
            images={images.map((i) => ({ id: i.id, url: signed.get(i.objectKey) ?? null, slot: i.slot }))}
          />
        </Card>
        </div>
      ) : null}
    </div>
  );
}
