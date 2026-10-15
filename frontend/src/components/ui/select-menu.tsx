"use client";

import { Select } from "@/components/ui/controls";

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
  required?: boolean;
  invalid?: boolean;
  size?: "field" | "compact";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

/**
 * The option-array API the Showroom screens were written against, drawn by the ONE shared `Select` (hidden native
 * form-value carrier + `ListboxSelect` on the portaled FloatingMenu). Showroom V2 originally shipped its own popup
 * here; main's design-system rule (`menu-surfaces.test`) allows exactly one dropdown surface, so this is now only an
 * adapter and owns no popup, positioning or keyboard logic of its own.
 */
export function SelectMenu({ options, onChange, placeholder, invalid, ...rest }: Props) {
  return (
    <Select {...rest} aria-invalid={invalid || undefined} onChange={(event) => onChange?.(event.target.value)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
