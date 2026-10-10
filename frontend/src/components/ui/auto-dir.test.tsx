import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input, Textarea } from "./controls";

/**
 * An EMPTY `dir="auto"` field resolves to LTR, which put an Arabic placeholder (and the caret) at the LEFT of an
 * RTL page. The shared fields inherit the page direction while empty and switch to `auto` only once typed into.
 */
describe("dir=auto fields start at the logical start while empty", () => {
  it("Input: inherits the page direction when empty, goes auto when it has text, and back again", () => {
    render(<Input aria-label="n" dir="auto" placeholder="مثال" />);
    const input = screen.getByLabelText("n") as HTMLInputElement;
    expect(input.getAttribute("dir")).toBeNull();
    fireEvent.input(input, { target: { value: "Marble" } });
    expect(input.getAttribute("dir")).toBe("auto");
    fireEvent.input(input, { target: { value: "" } });
    expect(input.getAttribute("dir")).toBeNull();
    expect(input.className).toMatch(/text-start/);
  });

  it("Input: a prefilled value is auto from the first render; a controlled value follows the prop", () => {
    const { rerender } = render(<Input aria-label="n" dir="auto" value="رخام" onChange={() => {}} />);
    const input = screen.getByLabelText("n");
    expect(input.getAttribute("dir")).toBe("auto");
    rerender(<Input aria-label="n" dir="auto" value="" onChange={() => {}} />);
    expect(input.getAttribute("dir")).toBeNull();
  });

  it("Textarea behaves the same, and keeps the caller's onInput", () => {
    let seen = 0;
    render(<Textarea aria-label="d" dir="auto" onInput={() => (seen += 1)} />);
    const area = screen.getByLabelText("d");
    expect(area.getAttribute("dir")).toBeNull();
    fireEvent.input(area, { target: { value: "وصف" } });
    expect(area.getAttribute("dir")).toBe("auto");
    expect(seen).toBe(1);
  });

  it("an explicit dir is left alone (SKU / HEX / price fields stay LTR)", () => {
    render(<Input aria-label="c" dir="ltr" />);
    expect(screen.getByLabelText("c").getAttribute("dir")).toBe("ltr");
  });
});
