"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";

export type SelectMenuOption = { value: string; label: string; disabled?: boolean };

type Props = {
  options: readonly SelectMenuOption[];
  /** Controlled value. Omit it (and use `defaultValue`) for an uncontrolled field inside a form. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** When set, the chosen value is submitted with the surrounding form under this name. */
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: "field" | "compact";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

const MAX_PANEL_HEIGHT = 320;
const GAP = 4;
const EDGE = 8;

/**
 * The project's styled dropdown: a button + listbox (ARIA "select-only combobox"),
 * not the browser's native popup. The panel is portalled to <body> and positioned
 * from the trigger's rectangle, so it is anchored to the trigger, never clipped by a
 * parent's overflow, never behind a neighbouring card (z-popover), never widens the
 * page, and scrolls inside itself when the list is long. Focus stays on the trigger
 * (aria-activedescendant), so keyboard use is the native select's: Enter/Space/Arrows
 * open, Arrows/Home/End/typing move, Enter chooses, Escape closes, Tab leaves.
 */
export function SelectMenu({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  id,
  placeholder,
  disabled,
  invalid,
  size = "field",
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  "data-testid": testId,
}: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left?: number; right?: number; width: number; maxHeight: number } | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - EDGE - GAP;
    const above = rect.top - EDGE - GAP;
    const flip = below < 200 && above > below;
    const maxHeight = Math.max(120, Math.min(MAX_PANEL_HEIGHT, flip ? above : below));
    const rtl = getComputedStyle(trigger).direction === "rtl";
    const width = Math.max(rect.width, 176);
    // Align the panel's start edge with the trigger's, then keep it inside the viewport.
    const left = rtl ? Math.max(EDGE, rect.right - width) : Math.min(rect.left, window.innerWidth - width - EDGE);
    setBox({
      ...(flip ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      left: Math.max(EDGE, left),
      width: Math.min(width, window.innerWidth - EDGE * 2),
      maxHeight,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  const choose = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      setInner(option.value);
      onChange?.(option.value);
      close();
    },
    [options, onChange, close],
  );

  const openMenu = useCallback(
    (focusIndex?: number) => {
      if (disabled) return;
      place();
      setOpen(true);
      const enabled = (i: number) => i >= 0 && !options[i]?.disabled;
      setActive(focusIndex !== undefined && enabled(focusIndex) ? focusIndex : enabled(selectedIndex) ? selectedIndex : options.findIndex((o) => !o.disabled));
    },
    [disabled, place, options, selectedIndex],
  );

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onViewport = (e: Event) => {
      // Scrolling the list itself must not close or move it.
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (!open || active < 0) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i]!.disabled) return i;
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openMenu();
        else setActive((a) => step(a, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openMenu();
        else setActive((a) => step(a, -1));
        return;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(options.findIndex((o) => !o.disabled));
        }
        return;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(step(options.length, -1));
        }
        return;
      case "Enter":
      case " ":
        if (e.key === " " && typed.current.text && Date.now() - typed.current.at < 600) break; // a space inside a type-ahead search
        e.preventDefault();
        if (!open) openMenu();
        else choose(active);
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        return;
      case "Tab":
        if (open) close();
        return;
      default:
        break;
    }
    // Type-ahead: jump to the next option whose label starts with what was typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const start = (open ? active : selectedIndex) + 1;
      const order = [...options.keys()].map((_, i) => (start + i) % options.length);
      const hit = order.find((i) => !options[i]!.disabled && options[i]!.label.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) {
        if (open) setActive(hit);
        else choose(hit);
      }
    }
  };

  const compact = size === "compact";
  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        data-testid={testId}
        data-value={current}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-sm border bg-surface text-start text-body text-fg transition-colors",
          "hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid ? "border-danger" : "border-strong",
          open && "border-accent ring-2 ring-focus",
          compact ? "h-7 px-2.5 text-label" : "min-h-11 px-3",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", !selected && "text-fg-muted")}>{selected ? selected.label : (placeholder ?? "")}</span>
        <svg
          aria-hidden="true"
          width={compact ? 14 : 16}
          height={compact ? 14 : 16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("shrink-0 text-fg-muted transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              data-testid="select-menu-panel"
              style={{ position: "fixed", top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight }}
              className="z-popover overflow-y-auto overscroll-contain rounded-md border border-strong bg-surface py-1 shadow-card"
              dir={typeof document !== "undefined" ? (triggerRef.current ? getComputedStyle(triggerRef.current).direction : undefined) : undefined}
            >
              {options.map((option, index) => {
                const isSelected = option.value === current;
                const isActive = index === active;
                return (
                  <div
                    key={option.value}
                    id={`${uid}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-index={index}
                    data-active={isActive || undefined}
                    onPointerEnter={() => !option.disabled && setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-body text-fg",
                      isActive && "bg-surface-2",
                      isSelected && "font-semibold text-accent",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {isSelected ? (
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
