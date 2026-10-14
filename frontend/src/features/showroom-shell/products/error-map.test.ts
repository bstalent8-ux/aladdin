import { describe, expect, it } from "vitest";
import { mapOwnProductError } from "./error-map";

describe("own product error mapping", () => {
  it.each([
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, { code: "showroomProducts.errors.duplicateCode", field: "code" }],
    [{ message: "this product code is already used in your organization" }, { code: "showroomProducts.errors.duplicateCode", field: "code" }],
    [{ code: "22023", message: "unknown or inactive product category" }, { code: "showroomProducts.errors.categoryInvalid", field: "category" }],
    [{ code: "22023", message: "unit is not one of the supported product units" }, { code: "showroomProducts.errors.unitInvalid", field: "unit" }],
    [{ code: "23514", message: "a product can have at most 3 images" }, { code: "showroomProducts.errors.maxImages" }],
    [{ code: "22023", message: "an archived product must be restored before it can be edited" }, { code: "showroomProducts.errors.archived" }],
    [{ code: "40001", message: "product was modified concurrently (expected 1, found 2)" }, { code: "commerce.errors.conflict" }],
    [{ code: "VC001", message: "" }, { code: "commerce.errors.conflict" }],
    [{ code: "42501", message: "catalog.write required" }, { code: "commerce.errors.denied" }],
    [{ code: "42501", message: "not a member of this organization" }, { code: "commerce.errors.denied" }],
    [{ code: "22023", message: "weight must be a non-negative number of kilograms" }, { code: "showroomProducts.errors.invalid" }],
    [{ code: "XX000", message: "boom" }, { code: "states.genericRetry" }],
  ])("maps %j", (error, expected) => {
    expect(mapOwnProductError(error)).toEqual(expected);
  });

  it("never leaks raw database text", () => {
    const mapped = mapOwnProductError({ code: "23505", message: 'duplicate key value violates unique constraint "uq_products_org_code"' });
    expect(JSON.stringify(mapped)).not.toContain("uq_products_org_code");
  });

  it("copes with a missing error", () => {
    expect(mapOwnProductError(undefined).code).toBe("states.genericRetry");
  });
});
