"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Button, Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PriceInput } from "@/components/ui/price-input";
import { SelectMenu } from "@/components/ui/select-menu";
import { PackageIcon, XIcon } from "@/components/ui/icons";
import Link from "next/link";
import { CANONICAL_CATEGORY_CODES, PRODUCT_LIMITS, isOwnProductUnit, unitsForCategory } from "@/features/commerce/constants";
import { createOwnProductDraftAction, updateOwnProductAction, type OwnProductFormState } from "@/server/actions/own-products";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { countChars } from "@/lib/text/count-chars";
import { ColorField } from "./color-swatches";
import { ProductAudiencePicker } from "./product-audience-picker";
import type { ProductAudienceCode } from "./product-audiences";
import type { ProductColor } from "./color-items";
import { StagedPhotos } from "./staged-photos";
import { uploadProductImage } from "./upload-image";

const initial: OwnProductFormState = { ok: false };

export type ProductFormValues = {
  id: string;
  version: number;
  name: string;
  code: string | null;
  categoryCode: string | null;
  unit: string;
  colors: ProductColor[];
  /** Regular selling price in EGP; null for a historical product that has none yet. */
  basePrice: number | null;
  weightKg: number | null;
  sizeLabel: string | null;
  brand: string | null;
  description: string | null;
  /** The audiences the owner targets; a published product always has at least one. */
  audiences: readonly ProductAudienceCode[];
};

/**
 * Create / edit an own product. Binds to the own_product_* RPCs through Server
 * Actions; the database re-validates everything. Entered values survive a
 * validation error (the form is uncontrolled apart from the color list). Editing
 * carries the optimistic version, and a historical product keeps its current unit
 * as an extra option so it can be saved without being forced onto a new one.
 */
export function ProductForm({
  orgId,
  product,
  photos,
}: {
  orgId: string;
  product?: ProductFormValues;
  /** Edit only: the image manager, rendered inside the editor card beside the colors (it owns its own actions, so it sits OUTSIDE the <form> element). */
  photos?: ReactNode;
}) {
  const { t } = useI18n();
  const editing = Boolean(product);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editState, editAction] = useActionState(updateOwnProductAction, initial);
  // Create is ONE flow: the product is created as an inactive draft, the photos the
  // user staged on this screen are uploaded to it, and only then does the page move on.
  const [createState, setCreateState] = useState<OwnProductFormState>(initial);
  const [staged, setStaged] = useState<File[]>([]);
  const [category, setCategory] = useState<string>(product?.categoryCode ?? "");
  const unitChoices = unitsForCategory(category);
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading">("idle");
  const state = editing ? editState : createState;
  const fe = state.fieldErrors ?? {};

  // A failed submit moves keyboard focus to the first field that needs attention.
  useEffect(() => {
    if (state.ok || (!state.fieldErrors && !state.code)) return;
    const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    invalid?.focus();
  }, [state]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase !== "idle") return;
    setPhase("creating");
    const result = await createOwnProductDraftAction(new FormData(e.currentTarget));
    if (!result.ok) {
      setCreateState({ ok: false, code: result.code, fieldErrors: result.fieldErrors });
      setPhase("idle");
      return;
    }
    setPhase("uploading");
    let failed = false;
    for (const file of staged) {
      try {
        await uploadProductImage(result.productId, file);
      } catch {
        failed = true;
        break;
      }
    }
    router.push(`${SHOWROOM_ROOT}/my-products/${result.productId}/edit?created=1${failed ? "&photos=partial" : ""}${result.audiencesSaved === false ? "&audiences=missing" : ""}`);
  }
  const [colors, setColors] = useState<ProductColor[]>(product?.colors ?? []);
  const [description, setDescription] = useState(product?.description ?? "");
  const overLimit = countChars(description) > PRODUCT_LIMITS.descriptionMax;

  const keepsHistoricalUnit = product && !isOwnProductUnit(product.unit);

  return (
    <Card>
      <div className="mb-md flex flex-wrap items-center justify-between gap-x-md gap-y-sm border-b pb-md">
        <div className="flex min-w-0 items-center gap-sm">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent"><PackageIcon size={22} /></span>
          <div className="min-w-0 text-start">
            <h2 className="text-title leading-snug text-fg">{t("showroomProducts.cardTitle")}</h2>
            <p className="mt-0.5 text-label leading-relaxed text-fg-muted">{t("showroomProducts.cardSubtitle")}</p>
          </div>
        </div>
      </div>

      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-start text-body text-danger" data-testid="product-form-error">
          {t(state.code)}
        </p>
      ) : null}

      {/*
        One editor grid for create AND edit, in the reference's reading order. The <form> is display:contents so its
        sections are grid items (the edit photo manager has its own forms/buttons, so it is a sibling placed by `order`):
          row 1  name | code            row 2  category | price
          row 3  colours | photos       row 4  weight | size | unit
          row 5  brand | description     last   save / cancel
        Everything follows the page direction (start = right in Arabic), so the first field of each row is on the right.
      */}
      <div className="grid min-w-0 items-start gap-x-md gap-y-md text-start tablet:grid-cols-2" data-testid="product-editor-grid">
        <form ref={formRef} action={editing ? editAction : undefined} onSubmit={editing ? undefined : onCreate} className="contents" noValidate data-testid="product-form">
          {editing ? (
            <>
              <input type="hidden" name="productId" value={product!.id} />
              <input type="hidden" name="expectedVersion" value={product!.version} />
              <input type="hidden" name="currentUnit" value={product!.unit} />
            </>
          ) : (
            <input type="hidden" name="orgId" value={orgId} />
          )}

          <div className="order-1 min-w-0">
            <LabeledField label={t("showroomProducts.fields.name")} htmlFor="name" error={fe.name ? t(fe.name) : undefined}>
              <Input id="name" name="name" required maxLength={PRODUCT_LIMITS.nameMax} defaultValue={product?.name ?? ""} dir="auto" aria-invalid={fe.name ? true : undefined} />
            </LabeledField>
          </div>
          <div className="order-2 min-w-0">
            <LabeledField label={t("showroomProducts.fields.code")} htmlFor="code" hint={t("showroomProducts.fields.codeHint")} error={fe.code ? t(fe.code) : undefined}>
              <Input id="code" name="code" required maxLength={PRODUCT_LIMITS.codeMax} dir="ltr" defaultValue={product?.code ?? ""} aria-invalid={fe.code ? true : undefined} className="text-start rtl:text-right" />
            </LabeledField>
          </div>
          <div className="order-3 min-w-0">
            <LabeledField label={t("showroomProducts.fields.category")} htmlFor="categoryCode" error={fe.category ? t(fe.category) : undefined}>
              <SelectMenu
                id="categoryCode"
                name="categoryCode"
                value={category}
                onChange={(v) => setCategory(v)}
                placeholder={t("showroomProducts.fields.selectCategory")}
                invalid={Boolean(fe.category)}
                options={CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) }))}
                data-testid="category-select"
              />
            </LabeledField>
          </div>
          <div className="order-4 min-w-0">
            <LabeledField label={t("showroomProducts.fields.price")} htmlFor="basePrice" hint={t("showroomProducts.fields.priceHint")} error={fe.price ? t(fe.price) : undefined}>
              <PriceInput id="basePrice" name="basePrice" currency={t("showroomProducts.fields.currency")} defaultValue={product?.basePrice ?? ""} invalid={Boolean(fe.price)} testId="price-input" />
            </LabeledField>
          </div>

          <div className="order-5 min-w-0">
            <ColorField colors={colors} onChange={setColors} error={fe.colors ? t(fe.colors) : undefined} />
          </div>
          {!editing ? <div className="order-6 min-w-0"><StagedPhotos files={staged} onChange={setStaged} disabled={phase !== "idle"} /></div> : null}

          <div className="order-7 grid min-w-0 gap-md tablet:col-span-2 tablet:grid-cols-3">
            <LabeledField label={t("showroomProducts.fields.weight")} htmlFor="weightKg" hint={t("showroomProducts.fields.weightHint")} optional={t("showroomProducts.fields.optional")} error={fe.weight ? t(fe.weight) : undefined}>
              <Input id="weightKg" name="weightKg" type="number" inputMode="decimal" min={0} max={PRODUCT_LIMITS.weightMax} step="0.001" dir="ltr" defaultValue={product?.weightKg ?? ""} aria-invalid={fe.weight ? true : undefined} className="text-start rtl:text-right" />
            </LabeledField>
            <LabeledField label={t("showroomProducts.fields.size")} htmlFor="sizeLabel" hint={t("showroomProducts.fields.sizeHint")} optional={t("showroomProducts.fields.optional")} error={fe.size ? t(fe.size) : undefined}>
              <Input id="sizeLabel" name="sizeLabel" maxLength={PRODUCT_LIMITS.sizeMax} defaultValue={product?.sizeLabel ?? ""} dir="auto" />
            </LabeledField>
            <LabeledField
              label={t("showroomProducts.fields.unit")}
              htmlFor="unit"
              hint={unitChoices.suggested.length ? `${t("showroomProducts.fields.unitSuggested")} ${unitChoices.suggested.map((u) => t(`commerce.units.${u}`)).join(" · ")}` : undefined}
              error={fe.unit ? t(fe.unit) : undefined}
            >
              <SelectMenu
                id="unit"
                name="unit"
                defaultValue={product?.unit ?? ""}
                placeholder={t("showroomProducts.fields.selectUnit")}
                invalid={Boolean(fe.unit)}
                options={[
                  ...unitChoices.all.map((u) => ({ value: u, label: t(`commerce.units.${u}`) })),
                  ...(keepsHistoricalUnit ? [{ value: product!.unit, label: t(`commerce.units.${product!.unit}`) }] : []),
                ]}
                data-testid="unit-select"
              />
            </LabeledField>
          </div>

          <div className="order-8 min-w-0">
            <LabeledField label={t("showroomProducts.fields.brand")} htmlFor="brand" optional={t("showroomProducts.fields.optional")}>
              <Input id="brand" name="brand" maxLength={PRODUCT_LIMITS.brandMax} defaultValue={product?.brand ?? ""} dir="auto" />
            </LabeledField>
          </div>
          <div className="order-9 min-w-0">
            <LabeledField label={t("showroomProducts.fields.description")} htmlFor="description" optional={t("showroomProducts.fields.optional")} error={overLimit ? t("showroomProducts.validation.descriptionChars") : fe.description ? t(fe.description) : undefined}>
              <CountedTextarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                max={PRODUCT_LIMITS.descriptionMax}
                unitLabel={t("showroomProducts.fields.chars")}
                dir="auto"
                rows={4}
                aria-invalid={fe.description ? true : undefined}
              />
            </LabeledField>
          </div>

          <div className="order-10 min-w-0 tablet:col-span-2">
            <ProductAudiencePicker initial={product?.audiences ?? []} error={fe.audiences ? t(fe.audiences) : undefined} />
          </div>

          <div className="order-11 flex flex-wrap items-center gap-sm border-t pt-md tablet:col-span-2">
            {editing ? (
              <SubmitButton variant="accent" pendingLabel={t("common.saving")}>{t("common.saveChanges")}</SubmitButton>
            ) : (
              <Button type="submit" variant="accent" disabled={phase !== "idle"} aria-busy={phase !== "idle"}>
                {phase === "creating" ? t("showroomProducts.creating") : phase === "uploading" ? t("showroomProducts.uploadingPhotos") : t("showroomProducts.saveProduct")}
              </Button>
            )}
            <Link
              href={`${SHOWROOM_ROOT}/my-products`}
              className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-strong px-md text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <XIcon size={14} />
              {t("showroomProducts.cancel")}
            </Link>
          </div>
        </form>
        {photos ? <div id="product-photos" className="order-6 min-w-0 scroll-mt-24">{photos}</div> : null}
      </div>
    </Card>
  );
}
