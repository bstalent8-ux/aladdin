import { describe, expect, it } from "vitest";
import { daysLeft, offerPhase, parsePublicOffer, parsePublicOffers, totalQuantity, FEED_READY_AUDIENCES, OFFER_AUDIENCE_CODES, OFFER_AUDIENCE_GROUPS, audienceCodesForGroups, groupsForAudienceCodes, appendUnique, parseOffersPage } from "./offer-model";
import { formatOfferDate, utcToZonedFields, zonedToUtcIso } from "./offer-datetime";
import { mapOfferError, parseOfferForm } from "./offer-input";

const HEX = (v: string) => `#${v}`;
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("offerPhase (mirrors app.offer_phase)", () => {
  const starts = "2026-10-10T00:00:00Z";
  const ends = "2026-10-20T00:00:00Z";
  it("derives scheduled / active / expired from a published offer's window", () => {
    expect(offerPhase("published", starts, ends, new Date("2026-10-09T23:59:59Z"))).toBe("scheduled");
    expect(offerPhase("published", starts, ends, new Date("2026-10-10T00:00:00Z"))).toBe("active");
    expect(offerPhase("published", starts, ends, new Date("2026-10-19T23:59:59Z"))).toBe("active");
    expect(offerPhase("published", starts, ends, new Date("2026-10-20T00:00:00Z"))).toBe("expired");
  });
  it("keeps draft / paused / archived as stored, whatever the clock says", () => {
    for (const s of ["draft", "paused", "archived"] as const) expect(offerPhase(s, starts, ends, new Date("2026-10-15T00:00:00Z"))).toBe(s);
  });
  it("counts days left, rounded up, and 0 after the end", () => {
    expect(daysLeft(ends, new Date("2026-10-17T12:00:00Z"))).toBe(3);
    expect(daysLeft(ends, new Date("2026-10-19T23:00:00Z"))).toBe(1);
    expect(daysLeft(ends, new Date("2026-10-21T00:00:00Z"))).toBe(0);
  });
});

describe("audiences", () => {
  it("every canonical audience has a feed, and the eight UI groups cover the approved account types", () => {
    expect([...FEED_READY_AUDIENCES].sort()).toEqual([...OFFER_AUDIENCE_CODES].sort());
    expect(OFFER_AUDIENCE_GROUPS.map((g) => g.id)).toEqual(["showroom", "supplier", "manufacturer", "importer", "contractor", "engineer", "craftsman", "customer"]);
  });
  it("maps each group to explicit canonical rows, never to a new enum", () => {
    expect(audienceCodesForGroups(["showroom"])).toEqual(["showroom_dealer"]);
    expect(audienceCodesForGroups(["contractor"])).toEqual(["contractor_company", "contractor"]);
    expect(audienceCodesForGroups(["engineer"])).toEqual(["design_office", "engineer"]);
    expect(audienceCodesForGroups(["craftsman"])).toEqual(["installer_technician"]);
    expect(audienceCodesForGroups(["customer"])).toEqual(["end_consumer"]);
    expect(audienceCodesForGroups(["nope"])).toEqual([]);
    expect(audienceCodesForGroups(OFFER_AUDIENCE_GROUPS.map((g) => g.id)).sort()).toEqual([...OFFER_AUDIENCE_CODES].sort());
  });
  it("reads groups back from stored rows", () => {
    expect(groupsForAudienceCodes(["design_office", "supplier"])).toEqual(["supplier", "engineer"]);
    expect(groupsForAudienceCodes(["wholesaler", "interior_designer"])).toEqual([]);
  });
});

describe("feed paging helpers", () => {
  const o = (id: string) => ({ id }) as never;
  it("appends a batch without repeating an offer already shown", () => {
    expect(appendUnique([o("a"), o("b")], [o("b"), o("c")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("parses the page envelope defensively", () => {
    const page = parseOffersPage({ items: [], total: "7", has_more: true, stats: { available: 7, ending: 2, fresh: 1 }, seller_types: ["supplier", 3] });
    expect(page).toEqual({ items: [], total: 7, hasMore: true, stats: { available: 7, ending: 2, fresh: 1 }, sellerTypes: ["supplier"] });
    expect(parseOffersPage(null).total).toBe(0);
  });
});

describe("parsePublicOffer", () => {
  const raw = {
    id: "o1",
    organization_id: "s1",
    title: "Package",
    description: null,
    seller: { id: "s1", name: "Seller", verified: true, slug: "seller", org_type: "supplier" },
    total_price: 4500,
    reference_price: 5800,
    currency: "EGP",
    starts_at: "2026-10-10T00:00:00Z",
    ends_at: "2026-10-20T00:00:00Z",
    published_at: null,
    items: [
      { product_id: "p1", name: "A", code: "A-1", quantity: 2, unit: "roll", size_label: null, weight_kg: 1.2, category_code: "wallpaper", colors: ["Sand"], color_items: [{ name: "Sand", hex: HEX("D8C7A6") }], image_key: null, image_ref: null },
      { product_id: "p2", name: "B", code: null, quantity: 1, unit: "meter", colors: ["Grey"], color_items: [] },
    ],
  };
  it("maps the database projection, structured colors included", () => {
    const o = parsePublicOffer(raw)!;
    expect(o.totalPrice).toBe(4500);
    expect(o.referencePrice).toBe(5800);
    expect(o.seller.orgType).toBe("supplier");
    expect(o.items[0]!.colors).toEqual([{ name: "Sand", hex: HEX("D8C7A6") }]);
    // A legacy named color has no value and is never guessed.
    expect(o.items[1]!.colors).toEqual([{ name: "Grey", hex: null }]);
    expect(totalQuantity(o.items)).toBe(3);
  });
  it("has no product price anywhere in its shape", () => {
    expect(JSON.stringify(parsePublicOffer(raw))).not.toMatch(/base_?price|basePrice/i);
  });
  it("drops malformed rows instead of half-showing them", () => {
    expect(parsePublicOffer({ ...raw, items: [] })).toBeNull();
    expect(parsePublicOffer({ ...raw, total_price: "x" })).toBeNull();
    expect(parsePublicOffers([raw, { id: 1 }, null])).toHaveLength(1);
  });
});

describe("offer date/time in the business time zone", () => {
  it("converts a Cairo wall time to the right instant (summer and winter offsets)", () => {
    const summer = zonedToUtcIso("2026-07-15", "10:00", "Africa/Cairo");
    const winter = zonedToUtcIso("2026-01-15", "10:00", "Africa/Cairo");
    expect(new Date(summer!).getUTCHours()).toBe(7); // UTC+3 with daylight saving
    expect(new Date(winter!).getUTCHours()).toBe(8); // UTC+2
  });
  it("round-trips through the zone", () => {
    const iso = zonedToUtcIso("2026-10-25", "23:59", "Africa/Cairo")!;
    expect(utcToZonedFields(iso, "Africa/Cairo")).toEqual({ date: "2026-10-25", time: "23:59" });
  });
  it("rejects impossible dates and times", () => {
    expect(zonedToUtcIso("2026-02-31", "10:00", "Africa/Cairo")).toBeNull();
    expect(zonedToUtcIso("2026-10-15", "25:00", "Africa/Cairo")).toBeNull();
    expect(zonedToUtcIso("15/10/2026", "10:00", "Africa/Cairo")).toBeNull();
  });
  it("falls back to Cairo for an unknown zone and formats Latin digits in Arabic", () => {
    expect(zonedToUtcIso("2026-10-15", "10:00", "Nope/Zone")).toBe(zonedToUtcIso("2026-10-15", "10:00", "Africa/Cairo"));
    expect(formatOfferDate("2026-10-15T08:00:00Z", "ar")).toMatch(/15/);
  });
});

function form(over: Record<string, string | string[]> = {}) {
  const fd = new FormData();
  const base: Record<string, string | string[]> = {
    title: "  Interior   package ",
    description: "Short",
    totalPrice: "3,900",
    referencePrice: "5800",
    startDate: "2026-10-15",
    startTime: "10:00",
    endDate: "2026-10-25",
    endTime: "23:59",
    items: JSON.stringify([{ productId: P1, quantity: 5 }, { productId: P2, quantity: 1 }]),
    audience: ["supplier", "importer"],
    ...over,
  };
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

describe("parseOfferForm", () => {
  it("builds the payload: one package price, quantities, instants, canonical audiences", () => {
    const r = parseOfferForm(form({ totalPrice: "3900" }), "Africa/Cairo");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Interior package");
    expect(r.value.totalPrice).toBe(3900);
    expect(r.value.referencePrice).toBe(5800);
    expect(r.value.items).toEqual([{ productId: P1, quantity: 5 }, { productId: P2, quantity: 1 }]);
    expect(r.value.audiences).toEqual(["supplier", "importer"]);
    expect(new Date(r.value.endsAt) > new Date(r.value.startsAt)).toBe(true);
  });
  it("limits the offer description to 250 CHARACTERS: 250 accepted, 251 refused, Arabic and English alike", () => {
    const parse = (description: string) => parseOfferForm(form({ totalPrice: "3900", description }), "Africa/Cairo");
    expect(parse("").ok).toBe(true);
    expect(parse("a".repeat(250)).ok).toBe(true);
    expect(parse("ع".repeat(250)).ok).toBe(true);
    expect(parse("a".repeat(251))).toMatchObject({ ok: false, fieldErrors: { description: "showroomOffers.errors.description" } });
    expect(parse("ع".repeat(251))).toMatchObject({ ok: false, fieldErrors: { description: "showroomOffers.errors.description" } });
    expect(parse(Array.from({ length: 200 }, () => "w").join(" "))).toMatchObject({ ok: false });
  });
  it("treats the price before the offer as optional", () => {
    const r = parseOfferForm(form({ totalPrice: "3900", referencePrice: "" }), "Africa/Cairo");
    expect(r.ok && r.value.referencePrice).toBe(null);
  });
  it("refuses a price before the offer that is not greater", () => {
    const r = parseOfferForm(form({ totalPrice: "3900", referencePrice: "3900" }), "Africa/Cairo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.referencePrice).toBe("showroomOffers.errors.priceBefore");
  });
  it.each([
    ["a short name", { title: "x" }, "title"],
    ["a zero price", { totalPrice: "0" }, "totalPrice"],
    ["three decimals", { totalPrice: "10.123" }, "totalPrice"],
    ["end before start", { endDate: "2026-10-01" }, "dates"],
    ["no items", { items: "[]" }, "items"],
    ["quantity 0", { items: JSON.stringify([{ productId: P1, quantity: 0 }]) }, "items"],
    ["fractional quantity", { items: JSON.stringify([{ productId: P1, quantity: 1.5 }]) }, "items"],
    ["a duplicate product", { items: JSON.stringify([{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }]) }, "items"],
    ["no audience", { audience: [] }, "audiences"],
    ["a translated audience label", { audience: ["مورد"] }, "audiences"],
  ])("refuses %s", (_name, over, field) => {
    const r = parseOfferForm(form(over as Record<string, string | string[]>), "Africa/Cairo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors[field]).toBeTruthy();
  });
});

describe("mapOfferError", () => {
  it("never leaks database text and routes known refusals to fields", () => {
    expect(mapOfferError({ code: "40001", message: "offer was modified concurrently" }).code).toBe("showroomOffers.errors.conflict");
    expect(mapOfferError({ code: "VC001", message: "" }).code).toBe("showroomOffers.errors.conflict");
    expect(mapOfferError({ code: "42501", message: "catalog.publish required" }).code).toBe("showroomOffers.errors.denied");
    expect(mapOfferError({ code: "22023", message: "the price before the offer must be greater than the offer price" })).toEqual({ code: "showroomOffers.errors.priceBefore", field: "referencePrice" });
    expect(mapOfferError({ code: "22023", message: "quantity must be a whole number of at least 1" }).field).toBe("items");
    expect(mapOfferError({ message: "boom: secret sql" }).code).toBe("showroomOffers.errors.generic");
  });
});
