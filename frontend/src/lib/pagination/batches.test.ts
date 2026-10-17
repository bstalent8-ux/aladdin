import { describe, expect, it } from "vitest";
import { appendUniqueById, lessCount } from "./batches";

describe("lessCount — Show less removes exactly one batch", () => {
  it("steps down one batch at a time", () => {
    expect([40, 30, 20].map((n) => lessCount(n))).toEqual([30, 20, 10]);
  });
  it("drops a partial last batch in one step (37 -> 30)", () => {
    expect(lessCount(37)).toBe(30);
    expect(lessCount(11)).toBe(10);
  });
  it("never goes below the first batch", () => {
    expect(lessCount(10)).toBe(10);
    expect(lessCount(4)).toBe(4);
  });
});

describe("appendUniqueById", () => {
  it("drops rows already shown and keeps the order", () => {
    const out = appendUniqueById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
