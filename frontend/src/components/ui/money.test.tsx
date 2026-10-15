import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Money, formatAmount } from "./money";
import { PriceInput } from "./price-input";
import { IconStat } from "./icon-stat";
import { PackageIcon } from "./icons";

describe("Money — number and currency as one bidi-safe unit", () => {
  it("formats the number with Latin digits, grouping and decimals only when present", () => {
    expect(formatAmount(3900)).toBe("3,900");
    expect(formatAmount(159.5)).toBe("159.50");
    expect(formatAmount(1.5)).toBe("1.50");
  });

  it("isolates the figure as LTR and the Arabic currency in its own RTL run, number first in reading order", () => {
    const { container } = render(
      <div dir="rtl">
        <Money amount={3900} currency="ج.م" locale="ar" testId="m" />
      </div>,
    );
    const m = screen.getByTestId("m");
    expect(m.textContent).toBe("3,900 ج.م");
    const [num, cur] = Array.from(m.querySelectorAll("bdi"));
    expect(num!.getAttribute("dir")).toBe("ltr");
    expect(num!.textContent).toBe("3,900");
    expect(cur!.getAttribute("dir")).toBe("rtl");
    expect(cur!.textContent).toBe("ج.م");
    // the wrapper itself is NOT forced to ltr (that is what used to mangle the Arabic abbreviation)
    expect(m.getAttribute("dir")).toBeNull();
    expect(container.querySelector('[dir="ltr"]:not(bdi)')).toBeNull();
    expect(m.className).toMatch(/whitespace-nowrap/);
  });

  it("English: figure and EGP both LTR", () => {
    render(<Money amount={3900} currency="EGP" locale="en" testId="m" />);
    const [num, cur] = Array.from(screen.getByTestId("m").querySelectorAll("bdi"));
    expect([num!.getAttribute("dir"), cur!.getAttribute("dir")]).toEqual(["ltr", "ltr"]);
    expect(screen.getByTestId("m").textContent).toBe("3,900 EGP");
  });
});

describe("PriceInput", () => {
  it("keeps the number direction-isolated, the token right beside it, and the field in the page direction", () => {
    render(
      <div dir="rtl">
        <PriceInput id="p" name="price" currency="ج.م" defaultValue="3900" testId="price" />
      </div>,
    );
    const input = screen.getByTestId("price") as HTMLInputElement;
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.inputMode).toBe("decimal");
    expect(input.value).toBe("3900");
    // the token is the NEXT sibling of the input: adjacent to the figure, never parked at the far edge
    expect(input.nextElementSibling?.textContent).toBe("ج.م");
    expect(screen.getByTestId("price-field").getAttribute("dir")).toBeNull();
  });

  it("is only as wide as what is typed, and marks the wrapper (not the input twice) when invalid", () => {
    render(<PriceInput id="p" name="price" currency="EGP" testId="price" invalid />);
    const input = screen.getByTestId("price") as HTMLInputElement;
    const width = () => Number.parseInt(input.style.width, 10);
    const empty = width();
    fireEvent.change(input, { target: { value: "1234567.89" } });
    expect(width()).toBeGreaterThan(empty);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("price-field").getAttribute("data-invalid")).toBe("true");
    expect(screen.getByTestId("price-field").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("IconStat", () => {
  it("is [icon + label] as ONE group, the isolated figure underneath, start-aligned", () => {
    render(<IconStat Icon={PackageIcon} label="إجمالي المنتجات" value="36" />);
    const stat = screen.getByTestId("icon-stat");
    const head = screen.getByTestId("icon-stat-head");
    expect(head.parentElement).toBe(stat);
    expect(head.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(head.textContent).toBe("إجمالي المنتجات");
    expect(head.nextElementSibling).toBe(screen.getByTestId("icon-stat-value"));
    expect(stat.className).not.toMatch(/justify-between/);
    expect(screen.getByTestId("icon-stat-value").querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
  });
});
