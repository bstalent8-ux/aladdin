"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { menuSurfaceClass } from "@/components/ui/menu";
import { COLOR_LIBRARY, libraryColorName, searchColors, type LibraryColor } from "./color-library";

const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 288;

/** Marks the portalled list so an enclosing "click outside closes me" handler can tell it is still inside the control. */
export const COLOR_LISTBOX_ATTR = "data-color-listbox";

/**
 * The colour NAME field: a searchable combobox over the canonical colour library — never a free-text
 * naming box. Typing filters (Arabic or English, partial words); Arrow keys move, Enter picks, Escape
 * closes only the list. The panel is portalled to <body> and anchored to the input (flips above when
 * there is no room below, scrolls inside itself, stays inside the viewport) on the shared menu surface.
 * Focus never leaves the input (aria-activedescendant); the chosen colour is announced politely.
 */
export function ColorCombobox({
  id,
  text,
  onTextChange,
  onPick,
  selected,
  placeholder,
  ariaLabel,
  testId = "color-name",
}: {
  id?: string;
  /** What the input shows. */
  text: string;
  onTextChange: (next: string) => void;
  onPick: (color: LibraryColor) => void;
  /** The library colour currently chosen (its row is marked, and its name no longer filters the list). */
  selected: LibraryColor | null;
  placeholder: string;
  ariaLabel: string;
  testId?: string;
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);

  // Right after a pick (or when an existing colour is opened for editing) the input shows the chosen name;
  // that must not narrow the list to one row. Typing again filters.
  const [showAll, setShowAll] = useState(selected !== null);
  const results = useMemo(() => (showAll ? COLOR_LIBRARY : searchColors(text)), [showAll, text]);

  const place = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - EDGE - GAP;
    const above = rect.top - EDGE - GAP;
    const flip = below < 180 && above > below;
    const width = Math.min(Math.max(rect.width, 224), window.innerWidth - EDGE * 2);
    const rtl = getComputedStyle(input).direction === "rtl";
    // Align the panel's start edge with the input's, then keep it inside the viewport.
    const left = rtl ? rect.right - width : rect.left;
    setBox({
      ...(flip ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
      width,
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, flip ? above : below)),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, results.length]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, place]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (color: LibraryColor) => {
    onPick(color);
    setShowAll(true);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (results.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === "Home" && open && results.length > 0 && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open && results.length > 0 && e.ctrlKey) {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      // Enter inside the popover must never submit the surrounding form; with the list open it picks the highlighted colour.
      e.preventDefault();
      if (open && results[active]) pick(results[active]!);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && results[active] ? `${uid}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        dir="auto"
        value={text}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          onTextChange(e.target.value);
          setShowAll(false);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          place();
          setOpen(true);
        }}
        onClick={() => {
          place();
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="min-h-11 w-full rounded-sm border border-strong bg-surface ps-3 pe-9 text-body text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("showroomProducts.fields.colorOpenList")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) return setOpen(false);
          inputRef.current?.focus();
          place();
          setOpen(true);
        }}
        className="absolute inset-y-0 end-0 grid w-9 place-items-center text-fg-muted"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("transition-transform", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {selected ? t("showroomProducts.fields.colorChosen", { name: libraryColorName(selected, locale) }) : open ? t("showroomProducts.fields.colorResults", { count: String(results.length) }) : ""}
      </p>
      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              {...{ [COLOR_LISTBOX_ATTR]: "" }}
              data-testid="color-listbox"
              dir={locale === "ar" ? "rtl" : "ltr"}
              style={{ position: "fixed", top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight }}
              className={cn(menuSurfaceClass, "z-popover overflow-y-auto overscroll-contain py-1")}
            >
              {results.length === 0 ? (
                <p className="px-3 py-2 text-label text-fg-muted" data-testid="color-no-match">{t("showroomProducts.fields.colorNoMatch")}</p>
              ) : (
                results.map((color, index) => {
                  const isSelected = selected?.code === color.code;
                  const other = locale === "ar" ? color.en : color.ar;
                  return (
                    <div
                      key={color.code}
                      id={`${uid}-opt-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      data-index={index}
                      data-code={color.code}
                      data-active={index === active || undefined}
                      onPointerEnter={() => setActive(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(color)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-body text-fg",
                        index === active && "bg-surface-2",
                        isSelected && "font-semibold text-accent",
                      )}
                    >
                      <span aria-hidden="true" style={{ backgroundColor: color.hex }} className="h-5 w-5 shrink-0 rounded-full border border-strong" />
                      <span className="min-w-0 flex-1 truncate">{libraryColorName(color, locale)}</span>
                      <span className="shrink-0 text-caption text-fg-muted" dir={locale === "ar" ? "ltr" : "rtl"}>{other}</span>
                    </div>
                  );
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
