"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input } from "@/components/ui/controls";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { PRODUCT_LIMITS } from "@/features/commerce/constants";
import { normalizeColorItems, normalizeHex, type ProductColor } from "./color-items";
import { DEFAULT_PRODUCT_COLOR, PRODUCT_COLOR_PALETTE } from "./color-palette";

const swatchBase = "relative inline-block shrink-0 rounded-full border border-strong";

/**
 * One color as a visible swatch. The name is discoverable on hover, on keyboard focus
 * and on click/tap (it stays until the swatch is clicked again or loses focus), and is
 * always the accessible name. A legacy color with no stored value draws as a neutral
 * dashed circle — its value is never guessed from the name.
 */
export function Swatch({
  color,
  size = "md",
  onClick,
  pressed,
  controls,
}: {
  color: ProductColor;
  size?: "sm" | "md";
  onClick?: () => void;
  pressed?: boolean;
  controls?: string;
}) {
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);
  const tipId = useId();
  const dim = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        data-testid="color-swatch"
        aria-label={color.hex ? color.name : `${color.name} — ${t("showroomProducts.fields.colorUnset")}`}
        aria-describedby={tipId}
        aria-expanded={controls ? pressed : undefined}
        aria-controls={controls}
        onClick={() => {
          setPinned((p) => !p);
          onClick?.();
        }}
        onBlur={() => setPinned(false)}
        style={color.hex ? { backgroundColor: color.hex } : undefined}
        className={cn(
          swatchBase,
          dim,
          !color.hex && "border-dashed bg-surface-2",
          pressed && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        {!color.hex ? (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-caption font-semibold text-fg-muted">?</span>
        ) : null}
      </button>
      <span
        id={tipId}
        role="tooltip"
        data-testid="color-tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full start-1/2 z-popover mb-1.5 w-max max-w-40 -translate-x-1/2 rounded-sm border border-strong bg-surface px-2 py-1 text-caption text-fg shadow-card rtl:translate-x-1/2",
          pinned ? "block" : "hidden group-hover:block group-focus-within:block",
        )}
      >
        {color.name}
      </span>
    </span>
  );
}

/** A row of swatches with a sensible maximum and a "+N" for the rest — it never grows the card. */
export function SwatchRow({ colors, max = 5 }: { colors: ProductColor[]; max?: number }) {
  const { t } = useI18n();
  if (colors.length === 0) return null;
  const shown = colors.slice(0, max);
  const rest = colors.length - shown.length;
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="card-colors" aria-label={t("showroomProducts.fields.colors")}>
      {shown.map((c) => (
        <li key={c.name} className="inline-flex">
          <Swatch color={c} size="sm" />
        </li>
      ))}
      {rest > 0 ? (
        <li className="text-caption text-fg-muted" dir="ltr" title={colors.slice(max).map((c) => c.name).join("، ")}>
          +{rest}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The editor's color control: the colors so far as swatches, and "Add color" opening a
 * small popover — palette, a custom picker and a hex field, plus a name. Clicking a
 * swatch re-opens the same popover to rename, recolor or remove it. The list is
 * submitted as one JSON field, `colorItems`.
 */
export function ColorField({
  colors,
  onChange,
  error,
}: {
  colors: ProductColor[];
  onChange: (next: ProductColor[]) => void;
  error?: string;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  /** -1 = closed, colors.length = adding, otherwise editing that index. */
  const [editing, setEditing] = useState<number>(-1);
  const [name, setName] = useState("");
  const [hexText, setHexText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const adding = editing === colors.length;
  const open = editing >= 0;
  const full = colors.length >= PRODUCT_LIMITS.colorsMax;

  const begin = (index: number) => {
    const current = colors[index];
    setEditing(index);
    setName(current?.name ?? "");
    setHexText(current?.hex ?? "");
    setProblem(null);
  };
  const close = (returnFocus = true) => {
    setEditing(-1);
    setProblem(null);
    if (returnFocus) addRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setEditing(-1);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);

  const hex = normalizeHex(hexText);

  const save = () => {
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) return setProblem(t("showroomProducts.validation.colorNameRequired"));
    if (trimmed.length > PRODUCT_LIMITS.colorMax) return setProblem(t("showroomProducts.validation.colorTooLong"));
    const legacyUnchanged = !adding && !colors[editing]?.hex && hexText.trim() === "";
    if (!hex && !legacyUnchanged) return setProblem(t("showroomProducts.validation.colorHexInvalid"));
    const next = adding ? [...colors, { name: trimmed, hex }] : colors.map((c, i) => (i === editing ? { name: trimmed, hex: hex ?? c.hex } : c));
    const clean = normalizeColorItems(next);
    // Names are unique (case-insensitively): a clash would have been silently merged.
    if (clean.length < next.length) return setProblem(t("showroomProducts.validation.colorDuplicate"));
    onChange(clean);
    close();
  };

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-col gap-1.5" data-testid="color-field">
      <span className="text-label font-medium text-fg-secondary" id={`${popId}-label`}>
        {t("showroomProducts.fields.colors")} <span className="font-normal text-fg-muted">({t("showroomProducts.fields.optional")})</span>
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${popId}-label`}>
        {colors.map((c, i) => (
          <Swatch key={c.name} color={c} pressed={editing === i} controls={editing === i ? popId : undefined} onClick={() => (editing === i ? close(false) : begin(i))} />
        ))}
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          className="shrink-0 whitespace-nowrap"
          disabled={full && !open}
          aria-expanded={adding}
          aria-controls={adding ? popId : undefined}
          onClick={() => (adding ? close(false) : begin(colors.length))}
          data-testid="add-color"
        >
          <PlusIcon size={16} />
          {t("showroomProducts.fields.addColor")}
        </Button>
      </div>
      {colors.length === 0 ? <p className="text-label text-fg-muted">{t("showroomProducts.fields.colorsEmpty")}</p> : null}
      <p className="text-label text-fg-muted">{t("showroomProducts.fields.colorsHint")}</p>
      {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
      <input type="hidden" name="colorItems" value={JSON.stringify(colors)} />

      {open ? (
        <div
          id={popId}
          role="dialog"
          aria-label={adding ? t("showroomProducts.fields.colorAddTitle") : t("showroomProducts.fields.colorEditTitle")}
          data-testid="color-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault();
              save();
            }
          }}
          className="absolute start-0 top-full z-popover mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-sm rounded-md border border-strong bg-surface p-sm shadow-card"
        >
          <p className="text-label font-semibold text-fg">{adding ? t("showroomProducts.fields.colorAddTitle") : t("showroomProducts.fields.colorEditTitle")}</p>
          <div role="group" aria-label={t("showroomProducts.fields.colorPick")} className="flex flex-wrap gap-1.5">
            {PRODUCT_COLOR_PALETTE.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={p}
                aria-pressed={hex === p}
                onClick={() => setHexText(p)}
                style={{ backgroundColor: p }}
                className={cn(swatchBase, "h-6 w-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", hex === p && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
              />
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-label text-fg-secondary">
              {t("showroomProducts.fields.colorHex")}
              <Input value={hexText} onChange={(e) => setHexText(e.target.value)} placeholder={DEFAULT_PRODUCT_COLOR} dir="ltr" maxLength={7} aria-invalid={hexText.trim() !== "" && !hex ? true : undefined} data-testid="color-hex" />
            </label>
            <label className="flex flex-col items-center gap-1 text-label text-fg-secondary">
              <span className="sr-only">{t("showroomProducts.fields.colorCustom")}</span>
              <input
                type="color"
                value={hex ?? DEFAULT_PRODUCT_COLOR}
                onChange={(e) => setHexText(e.target.value.toUpperCase())}
                aria-label={t("showroomProducts.fields.colorCustom")}
                className="h-11 w-11 cursor-pointer rounded-sm border border-strong bg-surface p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {t("showroomProducts.fields.colorName")}
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={PRODUCT_LIMITS.colorMax} placeholder={t("showroomProducts.fields.colorNamePlaceholder")} dir="auto" data-testid="color-name" autoFocus />
          </label>
          {problem ? <p role="alert" className="text-label text-danger">{problem}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!adding ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onChange(colors.filter((_, i) => i !== editing));
                  close();
                }}
                aria-label={t("showroomProducts.fields.removeColor", { name: colors[editing]?.name ?? "" })}
                className="text-danger"
              >
                <XIcon size={14} />
                {t("common.remove")}
              </Button>
            ) : <span />}
            <span className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => close()}>{t("showroomProducts.fields.colorCancel")}</Button>
              <Button type="button" variant="accent" onClick={save} data-testid="color-save">{adding ? t("showroomProducts.fields.colorAdd") : t("showroomProducts.fields.colorSave")}</Button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
