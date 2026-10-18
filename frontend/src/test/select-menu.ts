import { act, fireEvent, screen } from "@testing-library/react";

/**
 * Test helpers for the styled dropdown (`Select` / `SelectMenu`). Its options exist in
 * the DOM only while the list is open, so reading them means opening it.
 */
export const selectValue = (trigger: HTMLElement): string => trigger.getAttribute("data-value") ?? "";

export type OpenedOption = { value: string; label: string; disabled: boolean; selected: boolean };

/** Open the dropdown, read its options, leave it open (call `closeSelect` afterwards). */
export function openSelect(trigger: HTMLElement): OpenedOption[] {
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  return screen.getAllByRole("option").map((o) => ({
    value: o.getAttribute("data-value") ?? "",
    label: o.textContent ?? "",
    disabled: o.getAttribute("aria-disabled") === "true",
    selected: o.getAttribute("aria-selected") === "true",
  }));
}

export function closeSelect(trigger: HTMLElement) {
  act(() => {
    fireEvent.keyDown(trigger, { key: "Escape" });
  });
}

/** Read the options without leaving the list open. */
export function readOptions(trigger: HTMLElement): OpenedOption[] {
  const options = openSelect(trigger);
  closeSelect(trigger);
  return options;
}

/** Choose an option by its value, the way a user would (open, click). */
export function chooseOption(trigger: HTMLElement, value: string) {
  openSelect(trigger);
  const target = screen.getAllByRole("option").find((o) => o.getAttribute("data-value") === value);
  if (!target) throw new Error(`no option with value "${value}"`);
  fireEvent.click(target);
}
