"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { ProductMedia } from "@/features/commerce/product-media";
import { Badge, InlineError } from "@/components/ui/primitives";
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import {
  PRODUCT_IMAGE_ALLOWED_TYPES,
  PRODUCT_IMAGE_MAX_COUNT,
  moveImage,
  validateProductImageFile,
} from "@/lib/storage/product-images";

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-sm border border-strong bg-surface text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Photos chosen on the create screen, BEFORE the product exists. They live only in
 * the browser (object-URL previews) — nothing is uploaded, and no storage object or
 * metadata row exists, until the user submits the form. That is what makes
 * abandoning the screen safe: there is nothing to orphan. On submit the form creates
 * the draft product and then uploads these through the ordinary ownership path.
 */
export function StagedPhotos({ files, onChange, disabled }: { files: File[]; onChange: (next: File[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number>(-1);
  const [error, setError] = useState<string | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const accept = (file: File | undefined): file is File => {
    if (!file) return false;
    const valid = validateProductImageFile(file);
    if (!valid.ok) {
      setError(t(valid.code));
      return false;
    }
    setError(null);
    return true;
  };

  const onAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (accept(file) && files.length < PRODUCT_IMAGE_MAX_COUNT) onChange([...files, file]);
  };
  const onReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const index = replaceIndex.current;
    replaceIndex.current = -1;
    if (index >= 0 && accept(file)) onChange(files.map((f, i) => (i === index ? file : f)));
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-sm" data-testid="staged-photos" disabled={disabled}>
      <legend className="mb-1 text-label font-medium text-fg-secondary">{t("showroomProducts.photosStaged")}</legend>
      <p className="text-label text-fg-muted">{t("showroomProducts.images.hint")}</p>
      <p className="text-label text-fg-muted" data-testid="staged-count">{t("showroomProducts.images.count", { count: files.length })}</p>

      <ul className="grid grid-cols-3 gap-sm">
        {Array.from({ length: PRODUCT_IMAGE_MAX_COUNT }, (_, index) => {
          const file = files[index];
          return (
            <li key={file ? `${file.name}-${file.size}-${index}` : `empty-${index}`} className="flex min-w-0 flex-col gap-1.5">
              {file ? (
                <>
                  <div className="relative">
                    <ProductMedia src={previews[index] ?? null} alt={t("showroomProducts.images.photoN", { n: index + 1 })} aspect="aspect-square" />
                    {index === 0 ? <span className="absolute start-1 top-1 rounded-pill bg-surface"><Badge tone="accent">{t("showroomProducts.images.primary")}</Badge></span> : null}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1" role="group" aria-label={t("showroomProducts.images.photoN", { n: index + 1 })}>
                    <button type="button" className={iconButton} disabled={index === 0} onClick={() => onChange(moveImage(files, index, -1))} aria-label={t("showroomProducts.images.moveEarlier")} title={t("showroomProducts.images.moveEarlier")}>
                      <ChevronLeftIcon size={15} />
                    </button>
                    <button type="button" className={iconButton} disabled={index === files.length - 1} onClick={() => onChange(moveImage(files, index, 1))} aria-label={t("showroomProducts.images.moveLater")} title={t("showroomProducts.images.moveLater")}>
                      <ChevronRightIcon size={15} />
                    </button>
                    <button type="button" className={iconButton} onClick={() => { replaceIndex.current = index; replaceInput.current?.click(); }} aria-label={t("showroomProducts.images.replace")} title={t("showroomProducts.images.replace")}>
                      <PencilIcon size={15} />
                    </button>
                    <button type="button" className={cn(iconButton, "text-danger hover:text-danger")} onClick={() => onChange(files.filter((_, i) => i !== index))} aria-label={t("showroomProducts.images.remove")} title={t("showroomProducts.images.remove")}>
                      <TrashIcon size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  disabled={index !== files.length}
                  onClick={() => addInput.current?.click()}
                  className="grid aspect-square w-full place-items-center rounded-sm border border-dashed border-strong bg-surface text-fg-muted transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("showroomProducts.images.add")}
                  data-testid="staged-add"
                >
                  <span className="flex flex-col items-center gap-1 px-1 text-center text-label">
                    <PlusIcon size={18} />
                    <span className="hidden tablet:inline">{t("showroomProducts.uploadPhoto")}</span>
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <input ref={addInput} type="file" accept={PRODUCT_IMAGE_ALLOWED_TYPES.join(",")} className="sr-only" tabIndex={-1} onChange={onAdd} data-testid="staged-input" />
      <input ref={replaceInput} type="file" accept={PRODUCT_IMAGE_ALLOWED_TYPES.join(",")} className="sr-only" tabIndex={-1} onChange={onReplace} data-testid="staged-replace-input" />
      {files.length >= PRODUCT_IMAGE_MAX_COUNT ? <p className="text-label text-fg-muted">{t("showroomProducts.images.full")}</p> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </fieldset>
  );
}
