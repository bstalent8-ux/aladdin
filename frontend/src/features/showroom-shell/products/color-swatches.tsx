"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { menuSurfaceClass } from "@/components/ui/menu";
import { Button, Input } from "@/components/ui/controls";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { PRODUCT_LIMITS } from "@/features/commerce/constants";
import { colorDisplayName, colorFromLibrary, customColor, isAutoCustomName, normalizeColorItems, normalizeHex, type ProductColor } from "./color-items";
import { COLOR_LISTBOX_ATTR, ColorCombobox } from "./color-combobox";
import { CUSTOM_COLOR_CODE, DEFAULT_PRODUCT_COLOR, colorByCode, colorByHex, libraryColorName, normalizeColorSearch, searchColors, type LibraryColor } from "./color-library";

const swatchBase = "relative inline-block shrink-0 rounded-full border border-strong";
const GAP = 6;
const EDGE = 8;

/** The name a swatch shows and announces: a library colour in the READER's language, an unnamed value as "Custom colour #hex". */
export function useColorName() {
  const { t, locale } = useI18n();
  return useCallback((color: ProductColor) => colorDisplayName(color, locale, t("showroomProducts.fields.colorCustomName")), [locale, t]);
}

/**
 * ONE colour as a visible swatch — the single shared implementation every product card, row, detail table and
 * the editor uses. The name belongs to THIS swatch alone: it appears on pointer hover over the swatch itself,
 * on keyboard focus, and on click/tap (which pins it until the swatch is clicked again, Escape is pressed or
 * focus/click moves elsewhere). It is never attached to the card, the row of swatches or any wrapper: the
 * previous version used a CSS `group-hover`, which matches ANY ancestor marked `group` — and every card is one.
 *
 * The tooltip is a portalled, fixed-position popup on the shared menu surface (so it is above neighbouring
 * cards, never clipped by an overflow, and cannot cover metadata): centred on the swatch, above it, flipping
 * below when there is no room, and clamped to the viewport. It is also the swatch's accessible name. A legacy
 * colour with no stored value draws as a neutral dashed circle — its value is never guessed from the name.
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
  /** An action (the editor opens its popover). A plain swatch has none; its click only pins the name. */
  onClick?: () => void;
  pressed?: boolean;
  controls?: string;
}) {
  const { t, locale } = useI18n();
  const nameOf = useColorName();
  const label = nameOf(color);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const pointerDown = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = hovered || focused || pinned;
  const dim = size === "sm" ? "h-5 w-5" : "h-7 w-7";

  const place = useCallback(() => {
    const btn = btnRef.current;
    const tip = tipRef.current;
    if (!btn || !tip) return;
    const a = btn.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(EDGE, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - EDGE));
    const above = a.top - h - GAP;
    setPos({ left, top: above >= EDGE ? above : Math.min(a.bottom + GAP, window.innerHeight - h - EDGE) });
  }, []);

  useLayoutEffect(() => {
    if (visible) place();
    else setPos(null);
  }, [visible, label, place]);

  useEffect(() => {
    if (!visible) return;
    const onMove = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setHovered(false);
        setFocused(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setPinned(false);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [visible, place]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid="color-swatch"
        aria-label={color.hex ? label : `${label} — ${t("showroomProducts.fields.colorUnset")}`}
        aria-describedby={visible ? tipId : undefined}
        aria-expanded={controls ? pressed : undefined}
        aria-controls={controls}
        onPointerEnter={(e) => e.pointerType !== "touch" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        // Keyboard (or programmatic) focus shows the name; a focus that merely follows a click is the click's business.
        onFocus={() => {
          if (!pointerDown.current) setFocused(true);
          pointerDown.current = false;
        }}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onClick={() => {
          setPinned((p) => !p);
          onClick?.();
        }}
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
      {visible && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tipRef}
              id={tipId}
              role="tooltip"
              data-testid="color-tooltip"
              dir={locale === "ar" ? "rtl" : "ltr"}
              style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
              className={cn(menuSurfaceClass, "pointer-events-none z-popover w-max max-w-[min(16rem,calc(100vw-1rem))] px-2 py-1 text-caption text-fg")}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** A row of swatches with a sensible maximum and a "+N" for the rest — it never grows the card. */
export function SwatchRow({ colors, max = 5 }: { colors: ProductColor[]; max?: number }) {
  const { t } = useI18n();
  const nameOf = useColorName();
  if (colors.length === 0) return null;
  const shown = colors.slice(0, max);
  const rest = colors.length - shown.length;
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="card-colors" aria-label={t("showroomProducts.fields.colors")}>
      {shown.map((c) => (
        <li key={c.code && c.code !== CUSTOM_COLOR_CODE ? c.code : c.name} className="inline-flex">
          <Swatch color={c} size="sm" />
        </li>
      ))}
      {rest > 0 ? (
        <li className="text-caption text-fg-muted" dir="ltr" title={colors.slice(max).map(nameOf).join("، ")}>
          +{rest}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The editor's colour control: the colours so far as swatches, and "Add color" opening a small popover.
 * The popover is "search a colour by NAME" (a combobox over the canonical library, Arabic or English) plus
 * the colour code and the native colour picker: choosing a name fills the code; editing the code (or using
 * the picker) re-resolves to a library name when it matches EXACTLY, and otherwise becomes a "Custom colour"
 * with an automatic label — the owner never has to invent a name. Clicking a swatch re-opens the popover to
 * change or remove it. The list is submitted as one JSON field, `colorItems`.
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
  const { t, locale } = useI18n();
  const nameOf = useColorName();
  const wrapRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  /** -1 = closed, colors.length = adding, otherwise editing that index. */
  const [editing, setEditing] = useState<number>(-1);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LibraryColor | null>(null);
  const [hexText, setHexText] = useState("");
  /** The OPTIONAL name of a custom value; a library colour is never renamed, so it is only read while no library colour is picked. */
  const [customName, setCustomName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const adding = editing === colors.length;
  const open = editing >= 0;
  const full = colors.length >= PRODUCT_LIMITS.colorsMax;
  const hex = normalizeHex(hexText);

  const begin = (index: number) => {
    const current = colors[index];
    const lib = colorByCode(current?.code) ?? colorByHex(current?.hex);
    setEditing(index);
    setPicked(lib ?? null);
    setQuery(lib ? libraryColorName(lib, locale) : "");
    setHexText(current?.hex ?? "");
    setCustomName(!lib && current?.hex && !isAutoCustomName(current) ? current.name : "");
    setProblem(null);
  };
  const close = (returnFocus = true) => {
    setEditing(-1);
    setProblem(null);
    if (returnFocus) addRef.current?.focus();
  };

  // Bring the whole popover (and the room its list needs) into view when it opens.
  const showsCustomName = !picked && Boolean(hex);
  useEffect(() => {
    if (open) popRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, showsCustomName]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (wrapRef.current?.contains(target) || target.closest?.(`[${COLOR_LISTBOX_ATTR}]`)) return;
      setEditing(-1);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);

  const chooseLibrary = (lib: LibraryColor) => {
    setPicked(lib);
    setQuery(libraryColorName(lib, locale));
    setHexText(lib.hex);
    setProblem(null);
  };

  /** The colour value changed (typed code or native picker): a library name when it matches EXACTLY, otherwise custom. */
  const changeHex = (next: string) => {
    setHexText(next);
    setProblem(null);
    const value = normalizeHex(next);
    const lib = value ? colorByHex(value) : undefined;
    setPicked(lib ?? null);
    setQuery(lib ? libraryColorName(lib, locale) : "");
  };

  /** Typing a name exactly equal to a library name (either language) is picking it. */
  const changeQuery = (next: string) => {
    setQuery(next);
    setProblem(null);
    const exact = searchColors(next).find((c) => [c.ar, c.en].some((n) => normalizeColorSearch(n) === normalizeColorSearch(next)));
    if (exact && next.trim() !== "") {
      setPicked(exact);
      setHexText(exact.hex);
    } else if (picked) {
      setPicked(null);
    }
  };

  const preview: ProductColor | null = picked ? colorFromLibrary(picked, locale) : hex ? customColor(hex, customName) : null;

  const save = () => {
    const legacyUnchanged = !adding && !colors[editing]?.hex && hexText.trim() === "" && !picked;
    if (!preview && !legacyUnchanged) return setProblem(hexText.trim() !== "" ? t("showroomProducts.validation.colorHexInvalid") : t("showroomProducts.fields.colorChoose"));
    const base = preview ?? colors[editing]!;
    const duplicate = colors.some((c, i) => i !== editing && ((base.code && base.code !== CUSTOM_COLOR_CODE && c.code === base.code) || (base.hex && c.hex === base.hex) || c.name.toLowerCase() === base.name.toLowerCase()));
    if (duplicate) return setProblem(t("showroomProducts.validation.colorDuplicate"));
    const next = adding ? [...colors, base] : colors.map((c, i) => (i === editing ? base : c));
    onChange(normalizeColorItems(next));
    close();
  };

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-col gap-1.5" data-testid="color-field">
      <span className="text-label font-medium text-fg-secondary" id={`${popId}-label`}>
        {t("showroomProducts.fields.colors")} <span className="font-normal text-fg-muted">({t("showroomProducts.fields.optional")})</span>
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${popId}-label`}>
        {colors.map((c, i) => (
          <Swatch key={`${c.code ?? ""}|${c.name}`} color={c} pressed={editing === i} controls={editing === i ? popId : undefined} onClick={() => (editing === i ? close(false) : begin(i))} />
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
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={adding ? t("showroomProducts.fields.colorAddTitle") : t("showroomProducts.fields.colorEditTitle")}
          data-testid="color-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLElement).getAttribute("role") !== "combobox") {
              e.preventDefault();
              save();
            }
          }}
          className={cn(menuSurfaceClass, "absolute start-0 top-full z-popover mt-1 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-sm p-sm text-start")}
        >
          <p className="text-label font-semibold text-fg">{adding ? t("showroomProducts.fields.colorAddTitle") : t("showroomProducts.fields.colorEditTitle")}</p>
          <div className="flex flex-col gap-1 text-label text-fg-secondary">
            <label htmlFor={`${popId}-name`}>{t("showroomProducts.fields.colorName")}</label>
            <ColorCombobox
              id={`${popId}-name`}
              text={query}
              onTextChange={changeQuery}
              onPick={chooseLibrary}
              selected={picked}
              placeholder={t("showroomProducts.fields.colorNamePlaceholder")}
              ariaLabel={t("showroomProducts.fields.colorName")}
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-label text-fg-secondary">
              {t("showroomProducts.fields.colorHex")}
              <Input value={hexText} onChange={(e) => changeHex(e.target.value)} placeholder={DEFAULT_PRODUCT_COLOR} dir="ltr" maxLength={7} className="text-start rtl:text-right" aria-invalid={hexText.trim() !== "" && !hex ? true : undefined} data-testid="color-hex" />
            </label>
            <label className="flex flex-col items-center gap-1 text-label text-fg-secondary">
              <span className="sr-only">{t("showroomProducts.fields.colorPick")}</span>
              <input
                type="color"
                value={hex ?? DEFAULT_PRODUCT_COLOR}
                onChange={(e) => changeHex(e.target.value.toUpperCase())}
                aria-label={t("showroomProducts.fields.colorPick")}
                data-testid="color-picker"
                className="h-11 w-11 cursor-pointer rounded-sm border border-strong bg-surface p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          </div>
          {!picked && hex ? (
            <label className="flex flex-col gap-1 text-label text-fg-secondary">
              {t("showroomProducts.fields.colorCustomNameField")}
              <Input
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  setProblem(null);
                }}
                maxLength={PRODUCT_LIMITS.colorMax}
                placeholder={t("showroomProducts.fields.colorCustomNamePlaceholder")}
                dir="auto"
                data-testid="color-custom-name"
              />
            </label>
          ) : null}
          <div className="flex min-h-8 items-center gap-2 text-label text-fg-secondary" data-testid="color-preview" aria-live="polite">
            <span className="text-fg-muted">{t("showroomProducts.fields.colorPreview")}</span>
            {preview ? (
              <>
                <span aria-hidden="true" style={{ backgroundColor: preview.hex ?? undefined }} className={cn(swatchBase, "h-5 w-5")} data-testid="color-preview-swatch" />
                <span className="min-w-0 truncate font-medium text-fg" data-testid="color-preview-name">{nameOf(preview)}</span>
              </>
            ) : (
              <span className="text-fg-muted">—</span>
            )}
          </div>
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
                aria-label={t("showroomProducts.fields.removeColor", { name: colors[editing] ? nameOf(colors[editing]!) : "" })}
                className="text-danger"
              >
                <XIcon size={14} />
                {t("common.remove")}
              </Button>
            ) : <span />}
            <span className="flex items-center gap-2">
              <Button type="button" variant="accent" onClick={save} data-testid="color-save">{adding ? t("showroomProducts.fields.colorAdd") : t("showroomProducts.fields.colorSave")}</Button>
              <Button type="button" variant="outline" onClick={() => close()}>{t("showroomProducts.fields.colorCancel")}</Button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
