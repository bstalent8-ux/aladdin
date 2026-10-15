"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/controls";
import { countChars } from "@/lib/text/count-chars";
import { cn } from "@/lib/ui/cn";

/**
 * A textarea whose "n/max" counter lives INSIDE the field's visual area, at the logical end of the last line
 * (bottom-left in Arabic, bottom-right in English), in a reserved bottom band so it never covers typed text.
 * The counter itself is direction-isolated, so "127/250" never reads reversed in an RTL page.
 * The limit is a CHARACTER limit; going over turns the counter red and marks the field invalid (it does not
 * silently truncate a paste).
 */
export const CountedTextarea = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "maxLength"> & {
    value: string;
    max: number;
    /** Spoken after the number, e.g. "characters". */
    unitLabel: string;
    counterTestId?: string;
  }
>(function CountedTextarea({ value, max, unitLabel, counterTestId = "description-count", id, className, "aria-invalid": ariaInvalid, ...rest }, ref) {
  const count = countChars(value);
  const over = count > max;
  const counterId = id ? `${id}-count` : undefined;
  return (
    <div className="relative">
      <Textarea
        ref={ref}
        id={id}
        value={value}
        aria-invalid={over || ariaInvalid ? true : undefined}
        aria-describedby={counterId}
        className={cn("pb-8 text-start", className)}
        {...rest}
      />
      <span
        id={counterId}
        data-testid={counterTestId}
        className={cn("pointer-events-none absolute bottom-1.5 end-3 text-caption tabular-nums", over ? "font-semibold text-danger" : "text-fg-muted")}
      >
        <bdi dir="ltr" data-testid={`${counterTestId}-figure`}>{count}/{max}</bdi>
        <span className="sr-only"> {unitLabel}</span>
      </span>
    </div>
  );
});
