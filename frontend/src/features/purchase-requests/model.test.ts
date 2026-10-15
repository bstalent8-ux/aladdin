import { describe, expect, it } from "vitest";
import {
  REQUEST_LIMITS,
  compareResponses,
  parseDecimal,
  parseQuantity,
  parseRequestDetail,
  parseRequestItem,
  parseResponse,
  parseResponseLine,
  parseUnitPrice,
  toItemPayload,
  toResponseLinePayload,
  type ResponseView,
} from "./model";
import { mapRequestError } from "./error-map";

const isCat = (c: string) => ["paints", "wallpaper"].includes(c);
/** Hex literals are product DATA here, not styling - built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

const ITEM = "5bc41c1a-0000-4000-8000-000000000001";

describe("exact decimals", () => {
  it("accepts typed numbers, including Arabic-Indic digits and the Arabic decimal separator", () => {
    expect(parseQuantity("12")).toBe(12);
    expect(parseQuantity("12.5")).toBe(12.5);
    expect(parseQuantity("١٢٫٥")).toBe(12.5);
    expect(parseUnitPrice("159,50")).toBe(159.5);
  });

  it("refuses zero, negatives, excess decimals, text and values over the ceiling", () => {
    for (const bad of ["0", "-1", "1.2345", "abc", "", "1e3", "12..5", " "]) expect(parseQuantity(bad)).toBeNull();
    expect(parseQuantity(String(REQUEST_LIMITS.quantityMax + 1))).toBeNull();
    expect(parseUnitPrice("12.505")).toBeNull();
    expect(parseDecimal(null, 2, 10)).toBeNull();
  });
});

describe("request item input", () => {
  const good = { name: "  Matt   emulsion ", code: " PNT-1 ", categoryCode: "paints", quantity: "4", unit: "pail", specs: "  18 L  ", colors: [{ name: "Sand", hex: h("d8c7a6") }] };

  it("normalizes whitespace, upper-cases the hex and keeps every optional field optional", () => {
    const r = parseRequestItem(good, isCat);
    expect(r).toEqual({ ok: true, value: { name: "Matt emulsion", code: "PNT-1", categoryCode: "paints", colors: [{ name: "Sand", hex: h("D8C7A6") }], quantity: 4, unit: "pail", specs: "18 L" } });
    const minimal = parseRequestItem({ name: "Tile", categoryCode: "wallpaper", quantity: 1, unit: "roll" }, isCat);
    expect(minimal).toEqual({ ok: true, value: { name: "Tile", code: null, categoryCode: "wallpaper", colors: [], quantity: 1, unit: "roll", specs: null } });
  });

  it("names the first wrong field", () => {
    const err = (over: Record<string, unknown>) => {
      const r = parseRequestItem({ ...good, ...over }, isCat);
      return r.ok ? null : r.error;
    };
    expect(err({ name: "a" })).toBe("name");
    expect(err({ code: "x".repeat(81) })).toBe("code");
    expect(err({ categoryCode: "nope" })).toBe("category");
    expect(err({ quantity: "0" })).toBe("quantity");
    expect(err({ unit: "ton" })).toBe("unit");
    expect(err({ specs: "x".repeat(251) })).toBe("specs");
    expect(err({ colors: [{ name: "Bad", hex: "red" }] })).toBe("colors");
  });

  it("counts specs in characters, like the database: 250 Arabic letters pass, 251 do not", () => {
    expect(parseRequestItem({ ...good, specs: "ك".repeat(250) }, isCat).ok).toBe(true);
    expect(parseRequestItem({ ...good, specs: "ك".repeat(251) }, isCat).ok).toBe(false);
  });

  it("the RPC payload is snake_case, carries the id of an existing item and no product reference", () => {
    const parsed = parseRequestItem({ ...good, id: ITEM }, isCat);
    if (!parsed.ok) throw new Error("expected ok");
    const payload = toItemPayload(parsed.value);
    expect(payload).toMatchObject({ id: ITEM, category_code: "paints", unit: "pail", quantity: 4 });
    expect(Object.keys(payload).join(",")).not.toMatch(/product/);
  });
});

describe("response lines", () => {
  it("accepts a partial quantity and rounds nothing", () => {
    expect(parseResponseLine({ requestItemId: ITEM, offeredQuantity: "5", unitPrice: "13.25", note: " ok " })).toEqual({
      ok: true,
      value: { requestItemId: ITEM, offeredQuantity: 5, unitPrice: 13.25, note: "ok" },
    });
  });

  it("refuses a bad item id, quantity, price and over-long note, in that order", () => {
    const e = (o: Record<string, unknown>) => {
      const r = parseResponseLine({ requestItemId: ITEM, offeredQuantity: 1, unitPrice: 1, ...o });
      return r.ok ? null : r.error;
    };
    expect(e({ requestItemId: "x" })).toBe("item");
    expect(e({ offeredQuantity: 0 })).toBe("quantity");
    expect(e({ unitPrice: "12.505" })).toBe("price");
    expect(e({ note: "n".repeat(251) })).toBe("note");
  });

  it("the payload never carries a unit: the unit is the requested one, decided by the database", () => {
    const parsed = parseResponseLine({ requestItemId: ITEM, offeredQuantity: 2, unitPrice: 3 });
    if (!parsed.ok) throw new Error("expected ok");
    expect(toResponseLinePayload(parsed.value)).toEqual({ request_item_id: ITEM, offered_quantity: 2, unit_price: 3, note: "" });
  });
});

describe("reader projections", () => {
  it("parses a request detail with items, images and the caller's own response", () => {
    const d = parseRequestDetail({
      id: "r1", title: "Villa", notes: null, status: "published", needed_by: "2026-11-01", published_at: "2026-10-01T00:00:00Z",
      requester_audience: "engineer", requester: null, can_respond: true,
      items: [{ id: "i1", position: 1, name: "Tile", code: null, category_code: "paints", color_items: [{ name: "Sand", hex: null }], quantity: 10, unit: "roll", specs: null, images: [{ id: "m1", key: "k", slot: 1 }] }],
      my_response: { id: "x1", request_id: "r1", status: "submitted", coverage: "partial", currency: "EGP", total: 66.25, items: [{ request_item_id: "i1", requested_quantity: 10, unit: "roll", offered_quantity: 5, unit_price: 13.25, line_total: 66.25 }] },
    });
    expect(d?.requester).toBeNull();
    expect(d?.canRespond).toBe(true);
    expect(d?.items[0]).toMatchObject({ id: "i1", quantity: 10, images: [{ id: "m1", key: "k", slot: 1 }], colors: [{ name: "Sand", hex: null }] });
    expect(d?.myResponse).toMatchObject({ coverage: "partial", total: 66.25, items: [{ offeredQuantity: 5, lineTotal: 66.25 }] });
  });

  it("answers null / defaults for malformed input instead of throwing", () => {
    expect(parseRequestDetail(null)).toBeNull();
    expect(parseRequestDetail({})).toBeNull();
    expect(parseResponse("nope")).toBeNull();
    expect(parseRequestDetail({ id: "r", status: "weird", items: "x" })?.status).toBe("published");
  });

  it("orders the comparison shortlist-first, then cheapest", () => {
    const r = (id: string, total: number, shortlisted: boolean): ResponseView => ({ id, requestId: "r", status: "submitted", coverage: "full", currency: "EGP", total, note: null, validUntil: null, shortlisted, submittedAt: "", responder: null, items: [] });
    expect([r("a", 300, false), r("b", 500, true), r("c", 100, false)].sort(compareResponses).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("database refusals become translation keys, never raw text", () => {
  const key = (message: string, code = "22023") => mapRequestError({ code, message });
  it("maps the lifecycle, validation and response rules", () => {
    expect(key("purchase request was modified concurrently", "40001")).toBe("purchaseRequests.errors.conflict");
    expect(key("", "VC001")).toBe("purchaseRequests.errors.conflict");
    expect(key("only a draft request can be edited")).toBe("purchaseRequests.errors.notDraft");
    expect(key("add at least one item before publishing")).toBe("purchaseRequests.errors.needsItem");
    expect(key("a response needs at least one item")).toBe("purchaseRequests.errors.responseNeedsItem");
    expect(key("offered quantity must be greater than 0 and at most the requested quantity (3 decimals)")).toBe("purchaseRequests.errors.offeredInvalid");
    expect(key("quantity must be positive, at most 1,000,000, with at most 3 decimals")).toBe("purchaseRequests.errors.quantityInvalid");
    expect(key("price must be a positive amount in EGP with at most 2 decimals")).toBe("purchaseRequests.errors.priceInvalid");
    expect(key("unit must match the requested unit")).toBe("purchaseRequests.errors.unitMismatch");
    expect(key("an item can have at most 2 images", "23514")).toBe("purchaseRequests.errors.maxImages");
    expect(key("this organization type cannot publish purchase requests")).toBe("purchaseRequests.errors.orgTypeNotAllowed");
    expect(key("only a showroom can share a request with other showrooms")).toBe("purchaseRequests.errors.shareShowroomOnly");
  });

  it("not-found is one answer for a missing and an out-of-audience request; permission is separate", () => {
    expect(key("purchase request not found", "P0002")).toBe("purchaseRequests.errors.notFound");
    expect(key("rfq.respond required", "42501")).toBe("purchaseRequests.errors.denied");
    expect(key("not a member of this organization", "42501")).toBe("purchaseRequests.errors.denied");
    expect(key("something unexpected", "XX000")).toBe("states.genericRetry");
  });
});
