"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * A money field whose currency token sits right beside the number.
 *
 * The field itself follows the page direction (so the label above it and the field's start edge are RTL in
 * Arabic) while the NUMBER inside is direction-isolated (`dir="ltr"`: digits, group commas and the decimal point
 * never reverse). The input is only as wide as what is typed (in `ch`), so the currency token is always adjacent
 * to the figure — "3,900 ج.م" — instead of being parked at the far edge of a wide box.
 */
export function PriceInput({
  id,
  name,
  currency,
  value,
  defaultValue = "",
  onChange,
  placeholder = "0.00",
  invalid,
  disabled,
  testId,
  className,
}: {
  id: string;
  name: string;
  /** The localized currency label. */
  currency: string;
  /** Controlled use. Leave undefined for an uncontrolled field with `defaultValue`. */
  value?: string;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  const [inner, setInner] = useState(String(defaultValue ?? ""));
  const text = value ?? inner;
  const ref = useRef<HTMLInputElement>(null);
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) setInner(e.target.value);
    onChange?.(e.target.value);
  };
  return (
    <div
      data-testid={testId ? `${testId}-field` : undefined}
      data-invalid={invalid ? "true" : undefined}
      onClick={() => ref.current?.focus()}
      className={cn(
        "flex w-full cursor-text items-center gap-2 rounded-md border border-strong bg-canvas px-3.5 py-2.5 text-body-lg text-fg transition-[border-color,box-shadow] duration-fast",
        "focus-within:border-accent focus-within:ring-2 focus-within:ring-focus/40",
        "data-[invalid=true]:border-danger data-[invalid=true]:focus-within:ring-danger/30",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        ref={ref}
        id={id}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={text}
        onChange={change}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        data-testid={testId}
        style={{ width: `${Math.min(24, Math.max(text.length, placeholder.length, 3))}ch` }}
        className="min-w-0 max-w-full bg-transparent tabular-nums text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed"
      />
      <span aria-hidden="true" className="shrink-0 text-label text-fg-muted">{currency}</span>
    </div>
  );
}
