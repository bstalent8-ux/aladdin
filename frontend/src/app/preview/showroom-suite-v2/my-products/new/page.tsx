import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ProductForm } from "@/features/showroom-shell/products/product-form";

export const dynamic = "force-dynamic";

export default async function ShowroomNewProductPage() {
  const { org } = await requireShowroomContext();
  // Creating needs catalog.write (or ownership); the database enforces it again.
  if (!org.capabilities.includes("catalog.write") && !org.capabilities.includes("org.manage")) notFound();
  const t = createTranslator(resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value));
  return (
    <div className="flex flex-col gap-md" data-testid="new-product">
      <div className="flex flex-col gap-1">
        <Link href={`${SHOWROOM_ROOT}/my-products`} className="inline-flex items-center text-label text-fg-secondary hover:text-fg">
          <span aria-hidden="true" className="me-1 rtl:rotate-180">←</span>
          {t("showroomProducts.backToList")}
        </Link>
        <h1 className="text-headline text-fg">{t("showroomProducts.createTitle")}</h1>
        <p className="text-body text-fg-secondary">{t("showroomProducts.createSubtitle")}</p>
      </div>
      <ProductForm orgId={org.organizationId} />
    </div>
  );
}
