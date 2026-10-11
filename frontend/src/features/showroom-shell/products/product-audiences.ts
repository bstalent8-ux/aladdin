/**
 * The EIGHT product target audiences (Sales Team is deliberately NOT one: a Sales Team member
 * is shown what the workspace they represent is shown). `id` is the UI group (it reuses the
 * labels of the Create Offer audience picker); `code` is the canonical identifier stored by
 * the database (`product_audience_types.code`). Authorization never trusts this list - the
 * database re-validates every code and decides who may read a product.
 */
export const PRODUCT_AUDIENCE_GROUPS = [
  { id: "showroom", code: "showroom_dealer" },
  { id: "supplier", code: "supplier" },
  { id: "manufacturer", code: "manufacturer" },
  { id: "importer", code: "importer" },
  { id: "contractor", code: "contractor" },
  { id: "engineer", code: "engineer" },
  { id: "craftsman", code: "installer_technician" },
  { id: "customer", code: "end_consumer" },
] as const;

export type ProductAudienceGroupId = (typeof PRODUCT_AUDIENCE_GROUPS)[number]["id"];
export type ProductAudienceCode = (typeof PRODUCT_AUDIENCE_GROUPS)[number]["code"];

export const PRODUCT_AUDIENCE_CODES: readonly ProductAudienceCode[] = PRODUCT_AUDIENCE_GROUPS.map((g) => g.code);

export function isProductAudienceCode(value: unknown): value is ProductAudienceCode {
  return typeof value === "string" && (PRODUCT_AUDIENCE_CODES as readonly string[]).includes(value);
}

/** The submitted `audience` fields, deduplicated; anything that is not one of the eight is rejected as a whole. */
export function parseAudienceCodes(values: readonly unknown[]): { ok: true; codes: ProductAudienceCode[] } | { ok: false } {
  const codes: ProductAudienceCode[] = [];
  for (const v of values) {
    if (!isProductAudienceCode(v)) return { ok: false };
    if (!codes.includes(v)) codes.push(v);
  }
  return { ok: true, codes };
}
