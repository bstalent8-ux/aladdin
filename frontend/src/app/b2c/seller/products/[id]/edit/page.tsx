import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StorefrontIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ProductForm } from "@/features/marketplace-seller/product-form";
import { loadProductTypeSchemas, loadSellerProduct } from "@/server/queries/marketplace-seller-catalog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /b2c/seller/products/[id]/edit — the same form as Add, filled from the seller's
 * own product. The read RPC refuses another organization's product, and a product
 * of a business other than the ACTIVE one is treated as not found.
 */
export default async function EditMarketplaceProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { supabase, org, locale } = await requireApprovedSeller();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [product, schemas, sp] = await Promise.all([
    loadSellerProduct(supabase, id),
    loadProductTypeSchemas(supabase),
    searchParams,
  ]);
  if (!product || product.organizationId !== org.organizationId) notFound();
  const t = getMessages(locale).marketplaceSeller;
  return (
    <div className="flex flex-col gap-lg">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t.editTitle}
        subtitle={`${locale === "ar" ? product.nameAr : product.nameEn} · ${t.status[product.status]}`}
      />
      <ProductForm
        key={product.id}
        organizationId={org.organizationId}
        schemas={schemas}
        product={product}
        notice={sp.created ? t.created : undefined}
      />
    </div>
  );
}
