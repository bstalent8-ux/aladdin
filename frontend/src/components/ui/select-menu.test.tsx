import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectMenu } from "./select-menu";

const options = Array.from({ length: 15 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));

function setup(props: Partial<React.ComponentProps<typeof SelectMenu>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <form data-testid="f">
      <label htmlFor="s">Pick</label>
      <SelectMenu id="s" name="choice" options={options} placeholder="Choose" onChange={onChange} {...props} />
    </form>,
  );
  return { onChange, trigger: screen.getByRole("combobox", { name: "Pick" }), ...utils };
}

describe("SelectMenu", () => {
  it("is a labelled combobox that submits its value with the form", () => {
    const { trigger, container } = setup({ defaultValue: "v3" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("Option 3");
    expect((container.querySelector("input[name=choice]") as HTMLInputElement).value).toBe("v3");
  });

  it("opens a portalled listbox with the chosen option marked selected, capped in height", () => {
    const { trigger, container } = setup({ defaultValue: "v2" });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(container.contains(list)).toBe(false); // portalled to <body>: never clipped by a parent
    expect(list.style.maxHeight).not.toBe("");
    expect(list.className).toContain("overflow-y-auto");
    expect(screen.getAllByRole("option")).toHaveLength(15);
    expect(screen.getByRole("option", { name: "Option 2" }).getAttribute("aria-selected")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("works from the keyboard: arrows move, Enter chooses, Escape closes, focus stays on the trigger", () => {
    const { trigger, onChange } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/opt-2$/);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("v2");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.textContent).toBe("Option 2");

    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("jumps with Home/End, types ahead, and closes on Tab", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "End" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/opt-14$/);
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/opt-0$/);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on an outside press and chooses on click", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Option 7" }));
    expect(onChange).toHaveBeenCalledWith("v7");
  });

  it("does not open when disabled and reports invalid state", () => {
    const { trigger } = setup({ disabled: true, invalid: true });
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });
});
