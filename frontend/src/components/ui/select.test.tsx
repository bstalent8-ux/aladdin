import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./controls";
import { chooseOption, readOptions, selectValue } from "@/test/select-menu";

describe("Select (native-compatible API over the styled dropdown)", () => {
  it("reads <option> children, including mapped lists and fragments, with disabled options", () => {
    render(
      <Select aria-label="Role" defaultValue="b">
        <option value="">Choose</option>
        {["a", "b"].map((v) => (
          <option key={v} value={v}>{`Role ${v}`}</option>
        ))}
        <>
          <option value="c" disabled>Role c</option>
        </>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Role" });
    expect(trigger.tagName).toBe("BUTTON"); // not the browser's native popup
    expect(selectValue(trigger)).toBe("b");
    expect(readOptions(trigger).map((o) => [o.value, o.label, o.disabled])).toEqual([
      ["", "Choose", false],
      ["a", "Role a", false],
      ["b", "Role b", false],
      ["c", "Role c", true],
    ]);
  });

  it("calls onChange with an event whose target.value is the chosen value", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Role" name="role" defaultValue="" onChange={onChange}>
        <option value="">Choose</option>
        <option value="a">A</option>
      </Select>,
    );
    chooseOption(screen.getByRole("combobox"), "a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.value).toBe("a");
  });

  it("falls back to the first option when the value matches none, like a native select", () => {
    render(
      <Select aria-label="Role" defaultValue="zzz">
        <option value="x">X</option>
        <option value="y">Y</option>
      </Select>,
    );
    expect(selectValue(screen.getByRole("combobox"))).toBe("x");
  });

  it("submits its value with the form, and not when disabled", () => {
    const { container, rerender } = render(
      <form>
        <Select aria-label="Role" name="role" defaultValue="a">
          <option value="a">A</option>
        </Select>
      </form>,
    );
    const field = () => container.querySelector('input[name="role"]') as HTMLInputElement;
    expect(new FormData(container.querySelector("form")!).get("role")).toBe("a");
    rerender(
      <form>
        <Select aria-label="Role" name="role" defaultValue="a" disabled>
          <option value="a">A</option>
        </Select>
      </form>,
    );
    expect(field().disabled).toBe(true);
    expect(new FormData(container.querySelector("form")!).has("role")).toBe(false);
  });

  it("blocks submission while a required select is empty", () => {
    const { container } = render(
      <form>
        <Select aria-label="Role" name="role" defaultValue="" required>
          <option value="">Choose</option>
          <option value="a">A</option>
        </Select>
      </form>,
    );
    const form = container.querySelector("form")!;
    expect(form.checkValidity()).toBe(false);
    chooseOption(screen.getByRole("combobox"), "a");
    expect(form.checkValidity()).toBe(true);
  });

  it("tells the surrounding form it changed (dirty-form guard listens for input/change)", () => {
    const seen: string[] = [];
    const { container } = render(
      <form onInputCapture={() => seen.push("input")}>
        <Select aria-label="Role" name="role" defaultValue="">
          <option value="">Choose</option>
          <option value="a">A</option>
        </Select>
      </form>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(seen).toEqual([]);
    chooseOption(screen.getByRole("combobox"), "a");
    expect(container.querySelector("form")).not.toBeNull();
    expect(seen).toContain("input");
  });
});
