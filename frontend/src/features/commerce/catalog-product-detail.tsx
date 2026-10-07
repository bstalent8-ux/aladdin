import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Field, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";
import type { getMessages } from "@/lib/i18n/translate";

type Messages = ReturnType<typeof getMessages>;

/**
 * The published-product detail card, shared by the production catalog route and
 * the showroom suite's adapter route so the two can never drift. It is pure
 * presentation: the product comes from `getCatalogProduct` (RLS-scoped published
 * view) and each route decides the back link, the quote link and the permission
 * flags around it.
 */
export function CatalogProductDetail({
  product,
  m,
  isOwnOrg,
  canRfq,
  rfqHref,
  back,
  extra,
}: {
  product: CatalogRow & {
    id: string;
    category: NonNullable<CatalogRow["category"]>;
    unit: NonNullable<CatalogRow["unit"]>;
    organization_id: string;
  };
  m: Messages;
  isOwnOrg: boolean;
  canRfq: boolean;
  rfqHref: string;
  /** The route's own back link, rendered above the card. */
  back: ReactNode;
  /** Optional route-specific controls shown beside the quote action. */
  extra?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl pb-16 tablet:pb-0">
      {back}

      <Card>
        {/* The material itself, at the size a buyer can actually judge it — the
            card grid's thumbnail is for scanning, this is for deciding. */}
        <div className="grid gap-md tablet:grid-cols-[minmax(0,15rem)_1fr] tablet:items-start">
          <ProductMedia src={product.image_ref} alt={product.name ?? ""} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{product.name}</h1>
              <Badge tone="neutral">{m.commerce.categories[product.category]}</Badge>
            </div>
            {product.brand ? <p className="mt-1 text-body text-fg-secondary">{product.brand}</p> : null}
          </div>
        </div>

        {product.short_description ? (
          <p className="mt-md whitespace-pre-wrap text-body-lg text-fg-secondary">{product.short_description}</p>
        ) : null}

        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-3">
          <Field label={m.commerce.fields.unit}>{m.commerce.units[product.unit]}</Field>
          <Field label={m.commerce.fields.sku}>{product.sku ?? "—"}</Field>
          <Field label={m.commerce.catalog.supplier}>
            <span className="inline-flex items-center gap-1">
              {product.supplier_name}
              {product.supplier_verified ? (
                <span className="text-success" title={m.commerce.catalog.verifiedSupplier}>
                  <BadgeCheckIcon size={13} />
                </span>
              ) : null}
            </span>
          </Field>
        </dl>

        <div className="mt-lg flex flex-wrap items-center gap-sm border-t pt-md">
          {isOwnOrg ? (
            <p className="text-body text-fg-secondary">{m.commerce.catalog.ownProductNote}</p>
          ) : canRfq ? (
            <Link href={rfqHref}>
              <Button variant="accent">{m.commerce.catalog.requestQuote}</Button>
            </Link>
          ) : (
            <p className="text-body text-fg-muted">{m.commerce.catalog.rfqDenied}</p>
          )}
          {extra}
        </div>
      </Card>
    </div>
  );
}
