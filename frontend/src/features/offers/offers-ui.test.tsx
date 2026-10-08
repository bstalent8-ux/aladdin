import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { chooseOption } from "@/test/select-menu";
import { createTranslator } from "@/lib/i18n/translate";
import type { PublicOffer } from "./offer-model";
import type { OwnOffer, PickerProduct } from "@/server/queries/offers";

vi.mock("@/server/actions/offers", () => ({
  saveOfferAction: vi.fn(async () => ({ ok: false })),
  offerStatusAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { OffersFeedView } from "./offers-feed-view";
import { MyOffersView } from "./my-offers-view";
import { OfferBuilder, type BuilderInitial } from "./offer-builder";
import { OfferDetailView } from "./offer-detail-view";

const HEX = (v: string) => `#${v}`;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const offer = (over: Partial<PublicOffer> & { id: string }): PublicOffer => ({
  organizationId: "s1",
  title: "Interior package",
  description: "Limited package",
  seller: { id: "s1", name: "Delta Paints", verified: true, slug: "delta", orgType: "supplier" },
  totalPrice: 3900,
  referencePrice: 5800,
  currency: "EGP",
  startsAt: future(-1),
  endsAt: future(2),
  publishedAt: future(-1),
  items: [
    { productId: "p1", name: "Interior Paint", code: "PT-001", quantity: 5, unit: "pail", brand: null, description: null, sizeLabel: "18 L", weightKg: 1.2, categoryCode: "paints", colors: [{ name: "Sand", hex: HEX("D8C7A6") }, { name: "Legacy", hex: null }], imageKey: null, imageRef: null },
    { productId: "p2", name: "Primer", code: "PT-002", quantity: 2, unit: "pail", brand: null, description: null, sizeLabel: null, weightKg: null, categoryCode: "paints", colors: [], imageKey: null, imageRef: null },
    { productId: "p3", name: "Roller", code: null, quantity: 1, unit: "box", brand: null, description: null, sizeLabel: null, weightKg: null, categoryCode: null, colors: [], imageKey: null, imageRef: null },
    { productId: "p4", name: "Brush", code: null, quantity: 1, unit: "box", brand: null, description: null, sizeLabel: null, weightKg: null, categoryCode: null, colors: [], imageKey: null, imageRef: null },
  ],
  ...over,
});

beforeEach(() => {
  document.cookie = "aladdin-catalog-view=; max-age=0; path=/";
});

describe("Offers feed (audience)", () => {
  const offers = [offer({ id: "o1" }), offer({ id: "o2", title: "Flooring", seller: { id: "s2", name: "Nile Marble", verified: false, slug: null, orgType: "manufacturer" }, referencePrice: null, totalPrice: 1200, endsAt: future(20) })];
  const render = () => renderWithI18n(<OffersFeedView offers={offers} imageUrls={{}} locale="en" initialView="grid" />, "en");

  it("shows the package price, the optional price before, the products with quantities and the seller — and no product price", () => {
    render();
    const card = screen.getAllByTestId("offer-card")[0]!;
    expect(within(card).getByTestId("offer-total-price").textContent).toBe("3,900 EGP");
    expect(within(card).getByTestId("offer-reference-price").textContent).toBe("5,800 EGP");
    expect(within(card).getByText("Delta Paints")).toBeTruthy();
    expect(within(card).getByText("Interior Paint")).toBeTruthy();
    expect(within(card).getByText("5 ×")).toBeTruthy();
    expect(within(card).getByTestId("offer-more").textContent).toBe("+1 more products");
    // No percentage, no savings, no stock.
    expect(document.body.textContent).not.toMatch(/%|save|saving|stock|discount/i);
  });
  it("omits the price before when the owner gave none", () => {
    render();
    expect(within(screen.getAllByTestId("offer-card")[1]!).queryByTestId("offer-reference-price")).toBeNull();
  });
  it("narrows by search and by seller type, and offers a way back from an empty result", () => {
    render();
    fireEvent.change(screen.getByTestId("offers-search"), { target: { value: "flooring" } });
    expect(screen.getAllByTestId("offer-card")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("offers-search"), { target: { value: "nothing matches" } });
    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.getByText("No matching offers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByTestId("offer-card")).toHaveLength(2);
    chooseOption(screen.getByTestId("offers-seller-type"), "manufacturer");
    expect(screen.getAllByTestId("offer-card")).toHaveLength(1);
  });
  it("counts available / ending soon from the real offers", () => {
    render();
    expect(within(screen.getByTestId("offers-stat-available")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("offers-stat-ending")).getByText("1")).toBeTruthy();
  });
  it("shows an honest empty state with no fake cards", () => {
    renderWithI18n(<OffersFeedView offers={[]} imageUrls={{}} locale="en" initialView="grid" />, "en");
    expect(screen.getByText("No offers available right now")).toBeTruthy();
    expect(screen.queryByTestId("offer-card")).toBeNull();
  });
  it("links to the suite's own detail page", () => {
    render();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/preview/showroom-suite-v2/offers/o1");
  });
});

describe("Offer detail (audience)", () => {
  const t = createTranslator("en");
  it("lists every product with its code, quantity and real swatches; the unset legacy color stays unset; no price but the offer's", () => {
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1" })} imageUrls={{}} related={[]} locale="en" t={t} canRfq rfqHref="/b2b/rfqs/new?product=p1" />, "en");
    const rows = screen.getAllByTestId("offer-content-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByText("PT-001")).toBeTruthy();
    expect(within(rows[0]!).getByTestId("offer-content-quantity").textContent).toBe("5 ×");
    const swatches = within(rows[0]!).getAllByTestId("color-swatch");
    expect(swatches[0]!.getAttribute("style") ?? "").toMatch(/background/);
    expect(swatches[1]!.getAttribute("style") ?? "").not.toMatch(/background/);
    expect(screen.getByTestId("offer-total-price").textContent).toBe("3,900 EGP");
    expect(document.body.textContent).not.toMatch(/base price|%/i);
    expect(screen.getByTestId("offer-request-quote").getAttribute("href")).toBe("/b2b/rfqs/new?product=p1");
  });
  it("explains the missing permission instead of showing a dead button", () => {
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1" })} imageUrls={{}} related={[]} locale="en" t={t} canRfq={false} rfqHref="/x" />, "en");
    expect(screen.queryByTestId("offer-request-quote")).toBeNull();
  });
});

describe("My offers (management)", () => {
  const own = (over: Partial<OwnOffer> & { id: string; phase: OwnOffer["phase"] }): OwnOffer => ({
    title: `Offer ${over.id}`,
    description: null,
    status: over.phase === "active" || over.phase === "scheduled" || over.phase === "expired" ? "published" : (over.phase as OwnOffer["status"]),
    version: 2,
    totalPrice: 1000,
    referencePrice: null,
    startsAt: future(-2),
    endsAt: future(5),
    updatedAt: future(-1),
    itemCount: 3,
    totalQuantity: 6,
    invalidItemCount: 0,
    audiences: ["supplier"],
    items: [],
    ...over,
  });
  const list = (["draft", "scheduled", "active", "paused", "expired", "archived"] as const).map((phase) => own({ id: phase, phase }));
  const render = (canWrite = true, canPublish = true) => renderWithI18n(<MyOffersView offers={list} locale="en" canWrite={canWrite} canPublish={canPublish} />, "en");

  it("summarizes the lifecycle and filters by it", () => {
    render();
    expect(screen.getAllByTestId("my-offer-card")).toHaveLength(6);
    expect(within(screen.getByTestId("offers-stat-total")).getByText("6")).toBeTruthy();
    fireEvent.click(screen.getByTestId("offers-chip-paused"));
    expect(screen.getAllByTestId("my-offer-card")).toHaveLength(1);
    expect(screen.getByTestId("my-offer-card").getAttribute("data-phase")).toBe("paused");
  });
  it("offers the right primary action per phase", () => {
    render();
    const card = (phase: string) => screen.getAllByTestId("my-offer-card").find((c) => c.getAttribute("data-phase") === phase)!;
    expect(within(card("draft")).getByTestId("offer-action-publish")).toBeTruthy();
    expect(within(card("active")).getByTestId("offer-action-pause")).toBeTruthy();
    expect(within(card("paused")).getByTestId("offer-action-resume")).toBeTruthy();
    expect(within(card("expired")).getByTestId("offer-action-archive")).toBeTruthy();
    expect(within(card("archived")).getByTestId("offer-action-restore")).toBeTruthy();
    expect(within(card("scheduled")).getByTestId("offer-action-edit")).toBeTruthy();
  });
  it("hides lifecycle actions the caller cannot perform (the database still decides)", () => {
    render(false, false);
    expect(screen.queryByTestId("offer-action-publish")).toBeNull();
    expect(screen.queryByTestId("offer-action-pause")).toBeNull();
    expect(screen.getByTestId("my-offers-readonly")).toBeTruthy();
  });
  it("flags offers whose products stopped being valid", () => {
    renderWithI18n(<MyOffersView offers={[own({ id: "x", phase: "active", invalidItemCount: 2 })]} locale="en" canWrite canPublish />, "en");
    expect(screen.getByTestId("offer-needs-attention").textContent).toMatch(/2/);
  });
  it("shows the empty state with a create link, not fake cards", () => {
    renderWithI18n(<MyOffersView offers={[]} locale="en" canWrite canPublish />, "en");
    expect(screen.getByText("No offers yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create offer" }).getAttribute("href")).toBe("/preview/showroom-suite-v2/my-offers/new");
  });
});

describe("Offer builder", () => {
  const product = (i: number, over: Partial<PickerProduct> = {}): PickerProduct => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Product ${i}`,
    code: `P-${i}`,
    categoryCode: "paints",
    unit: "pail",
    published: true,
    colors: [],
    sizeLabel: null,
    weightKg: null,
    imageUrl: null,
    ...over,
  });
  const products = Array.from({ length: 12 }, (_, i) => product(i + 1));
  const initial: BuilderInitial = { offerId: null, version: null, title: "", description: "", totalPrice: "", referencePrice: "", startDate: "2026-10-15", startTime: "10:00", endDate: "2026-10-25", endTime: "23:59", items: [], audiences: [] };
  const render = (over: Partial<BuilderInitial> = {}, props: { readOnly?: boolean } = {}) =>
    renderWithI18n(<OfferBuilder orgId="o" zone="Africa/Cairo" products={products} initial={{ ...initial, ...over }} readOnly={props.readOnly ?? false} canPublish />, "en");
  const itemsField = () => JSON.parse((document.querySelector('input[name="items"]') as HTMLInputElement).value) as Array<{ productId: string; quantity: number }>;

  it("starts with nothing selected and says so", () => {
    render();
    expect(screen.getByTestId("offer-no-selected")).toBeTruthy();
    expect(itemsField()).toEqual([]);
  });
  it("adds products from the picker, each starting at quantity 1, and submits quantities", () => {
    render();
    fireEvent.click(screen.getByTestId("offer-add-products"));
    const picks = screen.getAllByTestId("offer-picker-item");
    fireEvent.click(picks[0]!);
    fireEvent.click(picks[1]!);
    expect(itemsField().map((i) => i.quantity)).toEqual([1, 1]);
    fireEvent.click(screen.getAllByTestId("offer-qty-plus")[0]!);
    fireEvent.click(screen.getAllByTestId("offer-qty-plus")[0]!);
    expect(itemsField()[0]!.quantity).toBe(3);
  });
  it("never goes below quantity 1 (buttons and typing)", () => {
    render({ items: [{ productId: products[0]!.id, quantity: 2 }] });
    const minus = screen.getByTestId("offer-qty-minus") as HTMLButtonElement;
    fireEvent.click(minus);
    expect(itemsField()[0]!.quantity).toBe(1);
    expect(minus.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("offer-qty-input"), { target: { value: "0" } });
    expect(itemsField()[0]!.quantity).toBe(1);
    fireEvent.change(screen.getByTestId("offer-qty-input"), { target: { value: "12" } });
    expect(itemsField()[0]!.quantity).toBe(12);
  });
  it("keeps many selected products inside ONE internally scrolling region", () => {
    render({ items: products.map((p) => ({ productId: p.id, quantity: 1 })) });
    expect(screen.getAllByTestId("offer-selected-row")).toHaveLength(12);
    const region = screen.getByTestId("offer-selected-scroll");
    expect(region.className).toMatch(/max-h-80/);
    expect(region.className).toMatch(/overflow-y-auto/);
    // the rows live inside the region; nothing else in the form scrolls for them
    expect(region.querySelectorAll('[data-testid="offer-selected-row"]')).toHaveLength(12);
  });
  it("removes a product and filters the picker by name or code", () => {
    render({ items: [{ productId: products[0]!.id, quantity: 1 }] });
    fireEvent.click(screen.getByTestId("offer-remove"));
    expect(itemsField()).toEqual([]);
    fireEvent.change(screen.getByTestId("offer-picker-search"), { target: { value: "P-7" } });
    expect(screen.getAllByTestId("offer-picker-item")).toHaveLength(1);
  });
  it("targets canonical audiences only: five selectable, the rest shown as soon and disabled", () => {
    render();
    fireEvent.click(screen.getByTestId("offer-audience-importer"));
    fireEvent.click(screen.getByTestId("offer-audience-supplier"));
    expect([...document.querySelectorAll('input[name="audience"]')].map((i) => (i as HTMLInputElement).value)).toEqual(["importer", "supplier"]);
    expect((screen.getByTestId("offer-audience-installer_technician") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("offer-audience-contractor") as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows the package price and the optional price before in the preview", () => {
    render({ totalPrice: "3900", referencePrice: "5800", title: "Pack" });
    expect(screen.getByTestId("offer-preview-price").textContent).toBe("3,900 EGP");
    expect(screen.getByTestId("offer-preview").textContent).toContain("5,800 EGP");
  });
  it("is read-only when the offer's state forbids editing", () => {
    render({ offerId: "x", version: 3, items: [{ productId: products[0]!.id, quantity: 1 }] }, { readOnly: true });
    expect(screen.getByTestId("offer-readonly")).toBeTruthy();
    expect((screen.getByTestId("offer-title-input") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId("offer-publish")).toBeNull();
    expect(screen.queryByTestId("offer-save-draft")).toBeNull();
  });
  it("marks a not-yet-active product so the owner knows it must be activated before publishing", () => {
    renderWithI18n(<OfferBuilder orgId="o" zone="Africa/Cairo" products={[product(1, { published: false })]} initial={initial} readOnly={false} canPublish />, "en");
    fireEvent.click(screen.getByTestId("offer-add-products"));
    expect(screen.getByTestId("offer-picker-item").textContent).toMatch(/Draft/);
  });
});
