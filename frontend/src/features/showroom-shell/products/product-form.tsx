"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Button, Input, Textarea, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PackageIcon, PlusIcon, XIcon } from "@/components/ui/icons";
import Link from "next/link";
import { CANONICAL_CATEGORY_CODES, OWN_PRODUCT_UNITS, PRODUCT_LIMITS, isOwnProductUnit } from "@/features/commerce/constants";
import { createOwnProductDraftAction, updateOwnProductAction, type OwnProductFormState } from "@/server/actions/own-products";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { normalizeColors } from "./product-input";
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
  colors: string[];
  weightKg: number | null;
  sizeLabel: string | null;
  brand: string | null;
  description: string | null;
};

/**
 * Create / edit an own product. Binds to the own_product_* RPCs through Server
 * Actions; the database re-validates everything. Entered values survive a
 * validation error (the form is uncontrolled apart from the color list). Editing
 * carries the optimistic version, and a historical product keeps its current unit
 * as an extra option so it can be saved without being forced onto a new one.
 */
export function ProductForm({ orgId, product }: { orgId: string; product?: ProductFormValues }) {
  const { t } = useI18n();
  const editing = Boolean(product);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editState, editAction] = useActionState(updateOwnProductAction, initial);
  // Create is ONE flow: the product is created as an inactive draft, the photos the
  // user staged on this screen are uploaded to it, and only then does the page move on.
  const [createState, setCreateState] = useState<OwnProductFormState>(initial);
  const [staged, setStaged] = useState<File[]>([]);
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
    router.push(`${SHOWROOM_ROOT}/my-products/${result.productId}/edit?created=1${failed ? "&photos=partial" : ""}`);
  }
  const [colors, setColors] = useState<string[]>(product?.colors ?? []);
  const [draftColor, setDraftColor] = useState("");
  const [colorNote, setColorNote] = useState<string | null>(null);

  const keepsHistoricalUnit = product && !isOwnProductUnit(product.unit);

  const addColor = () => {
    const next = normalizeColors([...colors, draftColor]);
    if (next.length > PRODUCT_LIMITS.colorsMax) return setColorNote(t("showroomProducts.validation.colorsTooMany"));
    if (draftColor.trim().length > PRODUCT_LIMITS.colorMax) return setColorNote(t("showroomProducts.validation.colorTooLong"));
    setColorNote(null);
    setColors(next);
    setDraftColor("");
  };

  return (
    <Card>
      <div className="mb-md flex items-center gap-sm border-b pb-md">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent"><PackageIcon size={22} /></span>
        <div className="min-w-0">
          <h2 className="text-title text-fg">{t("showroomProducts.cardTitle")}</h2>
          <p className="text-label text-fg-muted">{t("showroomProducts.cardSubtitle")}</p>
        </div>
      </div>

      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger" data-testid="product-form-error">
          {t(state.code)}
        </p>
      ) : null}

      <form ref={formRef} action={editing ? editAction : undefined} onSubmit={editing ? undefined : onCreate} className="flex flex-col gap-md" noValidate data-testid="product-form">
        {editing ? (
          <>
            <input type="hidden" name="productId" value={product!.id} />
            <input type="hidden" name="expectedVersion" value={product!.version} />
            <input type="hidden" name="currentUnit" value={product!.unit} />
          </>
        ) : (
          <input type="hidden" name="orgId" value={orgId} />
        )}

        <div className="grid min-w-0 gap-md tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <LabeledField label={t("showroomProducts.fields.code")} htmlFor="code" hint={t("showroomProducts.fields.codeHint")} error={fe.code ? t(fe.code) : undefined}>
            <Input id="code" name="code" required maxLength={PRODUCT_LIMITS.codeMax} dir="ltr" defaultValue={product?.code ?? ""} aria-invalid={fe.code ? true : undefined} />
          </LabeledField>
          <LabeledField label={t("showroomProducts.fields.name")} htmlFor="name" error={fe.name ? t(fe.name) : undefined}>
            <Input id="name" name="name" required maxLength={PRODUCT_LIMITS.nameMax} defaultValue={product?.name ?? ""} dir="auto" aria-invalid={fe.name ? true : undefined} />
          </LabeledField>
        </div>

        <LabeledField label={t("showroomProducts.fields.category")} htmlFor="categoryCode" error={fe.category ? t(fe.category) : undefined}>
          <Select id="categoryCode" name="categoryCode" defaultValue={product?.categoryCode ?? ""} aria-invalid={fe.category ? true : undefined}>
            <option value="" disabled>{t("showroomProducts.fields.selectCategory")}</option>
            {CANONICAL_CATEGORY_CODES.map((c) => (
              <option key={c} value={c}>{t(`commerce.canonicalCategories.${c}`)}</option>
            ))}
          </Select>
        </LabeledField>

        <div className={editing ? "grid min-w-0 gap-md" : "grid min-w-0 gap-md tablet:grid-cols-2"}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="color-draft" className="text-label font-medium text-fg-secondary">
              {t("showroomProducts.fields.colors")} <span className="font-normal text-fg-muted">({t("showroomProducts.fields.optional")})</span>
            </label>
            <div className="flex gap-sm">
              <Input
                id="color-draft"
                value={draftColor}
                maxLength={PRODUCT_LIMITS.colorMax}
                placeholder={t("showroomProducts.fields.colorPlaceholder")}
                dir="auto"
                onChange={(e) => setDraftColor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addColor();
                  }
                }}
                data-no-dirty
              />
              <Button type="button" variant="outline" className="shrink-0 whitespace-nowrap" onClick={addColor} disabled={!draftColor.trim() || colors.length >= PRODUCT_LIMITS.colorsMax} aria-label={t("showroomProducts.fields.addColor")}>
                <PlusIcon size={16} />
                <span className="hidden tablet:inline">{t("showroomProducts.fields.addColor")}</span>
              </Button>
            </div>
            <p className="text-label text-fg-muted">{t("showroomProducts.fields.colorsHint")}</p>
            {colorNote || fe.colors ? <p role="alert" className="text-label text-danger">{colorNote ?? t(fe.colors!)}</p> : null}
            {colors.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" data-testid="color-chips">
                {colors.map((color) => (
                  <li key={color} className="inline-flex max-w-full items-center gap-1 rounded-pill bg-surface-2 py-0.5 ps-3 pe-1 text-label text-fg">
                    <span className="min-w-0 truncate" dir="auto">{color}</span>
                    <button
                      type="button"
                      onClick={() => setColors(colors.filter((c) => c !== color))}
                      aria-label={t("showroomProducts.fields.removeColor", { name: color })}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <XIcon size={12} />
                    </button>
                    <input type="hidden" name="color" value={color} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {!editing ? <StagedPhotos files={staged} onChange={setStaged} disabled={phase !== "idle"} /> : null}
        </div>

        <div className="grid min-w-0 gap-md tablet:grid-cols-3">
          <LabeledField label={t("showroomProducts.fields.unit")} htmlFor="unit" error={fe.unit ? t(fe.unit) : undefined}>
            <Select id="unit" name="unit" defaultValue={product?.unit ?? ""} aria-invalid={fe.unit ? true : undefined}>
              <option value="" disabled>{t("showroomProducts.fields.selectUnit")}</option>
              {OWN_PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>{t(`commerce.units.${u}`)}</option>
              ))}
              {keepsHistoricalUnit ? <option value={product!.unit}>{t(`commerce.units.${product!.unit}`)}</option> : null}
            </Select>
          </LabeledField>
          <LabeledField label={t("showroomProducts.fields.size")} htmlFor="sizeLabel" hint={t("showroomProducts.fields.sizeHint")} optional={t("showroomProducts.fields.optional")} error={fe.size ? t(fe.size) : undefined}>
            <Input id="sizeLabel" name="sizeLabel" maxLength={PRODUCT_LIMITS.sizeMax} defaultValue={product?.sizeLabel ?? ""} dir="auto" />
          </LabeledField>
          <LabeledField label={t("showroomProducts.fields.weight")} htmlFor="weightKg" hint={t("showroomProducts.fields.weightHint")} optional={t("showroomProducts.fields.optional")} error={fe.weight ? t(fe.weight) : undefined}>
            <Input id="weightKg" name="weightKg" type="number" inputMode="decimal" min={0} max={PRODUCT_LIMITS.weightMax} step="0.001" dir="ltr" defaultValue={product?.weightKg ?? ""} aria-invalid={fe.weight ? true : undefined} />
          </LabeledField>
        </div>

        <div className="grid min-w-0 gap-md tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <LabeledField label={t("showroomProducts.fields.brand")} htmlFor="brand" optional={t("showroomProducts.fields.optional")}>
            <Input id="brand" name="brand" maxLength={PRODUCT_LIMITS.brandMax} defaultValue={product?.brand ?? ""} dir="auto" />
          </LabeledField>
          <LabeledField label={t("showroomProducts.fields.description")} htmlFor="description" optional={t("showroomProducts.fields.optional")}>
            <Textarea id="description" name="description" maxLength={PRODUCT_LIMITS.descriptionMax} defaultValue={product?.description ?? ""} dir="auto" className="min-h-11" rows={2} />
          </LabeledField>
        </div>

        <div className="flex flex-wrap items-center gap-sm border-t pt-md">
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
    </Card>
  );
}
