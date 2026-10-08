import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { chooseOption } from "@/test/select-menu";
import { createTranslator } from "@/lib/i18n/translate";
import type { OffersPage, PublicOffer } from "./offer-model";
import type { OwnOffer, PickerProduct } from "@/server/queries/offers";

vi.mock("@/server/actions/offers", () => ({
  saveOfferAction: vi.fn(async () => ({ ok: false })),
  offerStatusAction: vi.fn(async () => ({ ok: true })),
}));
const feed = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(async (_id: string, saved: boolean) => ({ ok: true, saved })),
}));
vi.mock("@/server/actions/offer-feed", () => ({
  loadOffersPageAction: (...args: unknown[]) => feed.load(...args),
  setOfferSavedAction: (...args: [string, boolean, string | null]) => feed.save(args[0], args[1]),
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
  saved: false,
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

const pageOf = (items: PublicOffer[], total = items.length): OffersPage => ({
  items,
  total,
  hasMore: items.length < total,
  stats: { available: total, ending: 1, fresh: 2 },
  sellerTypes: ["supplier", "manufacturer"],
});
const many = (n: number, from = 0) => Array.from({ length: n }, (_, i) => offer({ id: `o${from + i + 1}`, title: `Offer ${from + i + 1}` }));

describe("Offers feed (audience)", () => {
  const offers = [offer({ id: "o1" }), offer({ id: "o2", title: "Flooring", seller: { id: "s2", name: "Nile Marble", verified: false, slug: null, orgType: "manufacturer" }, referencePrice: null, totalPrice: 1200, endsAt: future(20) })];
  const render = (page: OffersPage = pageOf(offers)) => renderWithI18n(<OffersFeedView initialPage={page} initialImageUrls={{}} orgId="org1" locale="en" initialView="grid" />, "en");
  beforeEach(() => {
    feed.load.mockReset();
    feed.save.mockClear();
  });

  it("shows the package price, the optional price before, the products with quantities and the seller — and no product price", () => {
    render();
    const card = screen.getAllByTestId("offer-card")[0]!;
    expect(within(card).getByTestId("offer-total-price").textContent).toBe("3,900 EGP");
    expect(within(card).getByTestId("offer-reference-price").textContent).toBe("5,800 EGP");
    expect(within(card).getByText("Delta Paints")).toBeTruthy();
    expect(within(card).getByText("Interior Paint")).toBeTruthy();
    expect(within(card).getByText("5 ×")).toBeTruthy();
    expect(within(card).getByTestId("offer-more").textContent).toBe("+2 more products");
    expect(document.body.textContent).not.toMatch(/%|save |saving|stock|discount/i);
  });
  it("strikes the price before the offer through with the danger token, never the package price", () => {
    render();
    const card = screen.getAllByTestId("offer-card")[0]!;
    expect(within(card).getByTestId("offer-reference-price").className).toMatch(/line-through/);
    expect(within(card).getByTestId("offer-reference-price").className).toMatch(/decoration-danger/);
    expect(within(card).getByTestId("offer-total-price").className).not.toMatch(/line-through/);
  });
  it("omits the price before when the owner gave none", () => {
    render();
    expect(within(screen.getAllByTestId("offer-card")[1]!).queryByTestId("offer-reference-price")).toBeNull();
  });
  it("lays the grid out as 5 columns on a wide desktop, 4 on a desktop and 3 on a tablet", () => {
    render();
    const cls = screen.getByTestId("offers-grid").className;
    expect(cls).toMatch(/tablet:grid-cols-3/);
    expect(cls).toMatch(/desktop:grid-cols-4/);
    expect(cls).toMatch(/wide:grid-cols-5/);
  });
  it("keeps the seller, image, count, summary, prices, validity, bookmark and details link on every compact card", () => {
    render();
    const card = screen.getAllByTestId("offer-card")[0]!;
    expect(within(card).getByTestId("offer-seller")).toBeTruthy();
    expect(within(card).getByTestId("offer-collage")).toBeTruthy();
    expect(within(card).getByText("4 products")).toBeTruthy();
    expect(within(card).getByTestId("offer-lines")).toBeTruthy();
    expect(within(card).getByTestId("offer-price")).toBeTruthy();
    expect(within(card).getByText(/Available until/)).toBeTruthy();
    expect(within(card).getByTestId("offer-save")).toBeTruthy();
    expect(within(card).getByTestId("offer-view-details")).toBeTruthy();
  });
  it("shows the first batch only and loads the next as a real bounded query, without duplicates", async () => {
    render(pageOf(many(10), 25));
    expect(screen.getAllByTestId("offer-card")).toHaveLength(10);
    expect(screen.getByTestId("offers-shown").textContent).toBe("Showing 10 of 25");
    feed.load.mockResolvedValueOnce({ ok: true, page: pageOf([...many(2, 8), ...many(8, 10)], 25), imageUrls: {} });
    fireEvent.click(screen.getByTestId("offers-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("offer-card")).toHaveLength(18));
    // offset = what is already visible; a repeated id (o9, o10) is dropped
    expect(feed.load).toHaveBeenCalledWith("org1", expect.objectContaining({ sort: "newest", search: "" }), 10);
    const ids = screen.getAllByTestId("offer-card").map((c) => within(c).getByTestId("offer-view-details").getAttribute("href"));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("folds back to the first batch with Show less and keeps the filters", async () => {
    render(pageOf(many(10), 25));
    feed.load.mockResolvedValueOnce({ ok: true, page: pageOf(many(10, 10), 25), imageUrls: {} });
    fireEvent.click(screen.getByTestId("offers-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("offer-card")).toHaveLength(20));
    fireEvent.click(screen.getByTestId("offers-show-less"));
    expect(screen.getAllByTestId("offer-card")).toHaveLength(10);
    expect(screen.queryByTestId("offers-show-less")).toBeNull();
    expect(screen.getByTestId("offers-show-more")).toBeTruthy();
  });
  it("offers no pager when everything fits in the first batch", () => {
    render(pageOf(many(4), 4));
    expect(screen.queryByTestId("offers-show-more")).toBeNull();
    expect(screen.queryByTestId("offers-show-less")).toBeNull();
  });
  it("sends a changed filter to the server and restarts from the first batch", async () => {
    render(pageOf(many(10), 25));
    feed.load.mockResolvedValueOnce({ ok: true, page: pageOf([offers[1]!], 1), imageUrls: {} });
    chooseOption(screen.getByTestId("offers-seller-type"), "manufacturer");
    await waitFor(() => expect(screen.getAllByTestId("offer-card")).toHaveLength(1));
    expect(feed.load).toHaveBeenLastCalledWith("org1", expect.objectContaining({ sellerType: "manufacturer" }), 0);
    expect(screen.queryByTestId("offers-show-more")).toBeNull();
  });
  it("searches on the server and offers a way back from an empty result", async () => {
    render();
    feed.load.mockResolvedValueOnce({ ok: true, page: pageOf([], 0), imageUrls: {} });
    fireEvent.change(screen.getByTestId("offers-search"), { target: { value: "nothing matches" } });
    await waitFor(() => expect(screen.getByText("No matching offers")).toBeTruthy());
    expect(feed.load).toHaveBeenLastCalledWith("org1", expect.objectContaining({ search: "nothing matches" }), 0);
    feed.load.mockResolvedValueOnce({ ok: true, page: pageOf(offers), imageUrls: {} });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getAllByTestId("offer-card")).toHaveLength(2));
  });
  it("tells the reader when a batch could not be loaded, keeping what is shown", async () => {
    render(pageOf(many(10), 25));
    feed.load.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByTestId("offers-show-more"));
    await waitFor(() => expect(screen.getByTestId("offers-load-error")).toBeTruthy());
    expect(screen.getAllByTestId("offer-card")).toHaveLength(10);
  });
  it("counts available / ending soon from the whole eligible set", () => {
    render();
    expect(within(screen.getByTestId("offers-stat-available")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("offers-stat-ending")).getByText("1")).toBeTruthy();
  });
  it("groups each summary icon with its own label instead of parking it at the far edge", () => {
    render();
    const stat = within(screen.getByTestId("offers-stat-available")).getByTestId("icon-stat");
    expect(stat.className).not.toMatch(/justify-between/);
    expect(stat.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(stat.textContent).toContain("Offers available to you");
  });
  it("bookmarks an offer with accessible labels and a persisted server call", async () => {
    render();
    const btn = within(screen.getAllByTestId("offer-card")[0]!).getByTestId("offer-save");
    expect(btn.getAttribute("aria-label")).toBe("Save offer");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
    expect(btn.getAttribute("aria-label")).toBe("Remove from saved");
    expect(feed.save).toHaveBeenCalledWith("o1", true);
  });
  it("rolls the bookmark back when the server refuses", async () => {
    feed.save.mockResolvedValueOnce({ ok: false, saved: false });
    render();
    const btn = within(screen.getAllByTestId("offer-card")[0]!).getByTestId("offer-save");
    fireEvent.click(btn);
    await waitFor(() => expect(feed.save).toHaveBeenCalled());
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("false"));
  });
  it("shows a saved offer as saved", () => {
    render(pageOf([offer({ id: "o1", saved: true })]));
    expect(screen.getByTestId("offer-save").getAttribute("data-saved")).toBe("true");
  });
  it("shows an honest empty state with no fake cards", () => {
    render(pageOf([], 0));
    expect(screen.getByText("No offers available right now")).toBeTruthy();
    expect(screen.queryByTestId("offer-card")).toBeNull();
  });
  it("links to the shell's own detail page", () => {
    renderWithI18n(<OffersFeedView initialPage={pageOf(offers)} initialImageUrls={{}} orgId={null} locale="en" initialView="grid" detailBase="/home/offers" />, "en");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/home/offers/o1");
  });
});

describe("Offer detail (audience)", () => {
  const t = createTranslator("en");
  it("lists every product with its code, quantity and real swatches; the unset legacy color stays unset; no price but the offer's", () => {
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1" })} imageUrls={{}} related={[]} locale="en" t={t} canRfq orgId="org1" rfqHref="/b2b/rfqs/new?product=p1" />, "en");
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
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1" })} imageUrls={{}} related={[]} locale="en" t={t} canRfq={false} orgId="org1" rfqHref="/x" />, "en");
    expect(screen.queryByTestId("offer-request-quote")).toBeNull();
  });
  it("carries the same bookmark as the feed, and the struck-through price before", () => {
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1", saved: true })} imageUrls={{}} related={[]} locale="en" t={t} canRfq orgId="org1" rfqHref="/x" />, "en");
    expect(screen.getByTestId("offer-save").getAttribute("data-saved")).toBe("true");
    expect(screen.getByTestId("offer-reference-price").className).toMatch(/decoration-danger/);
  });
  it("hides the quotation block for accounts without an RFQ entry yet, keeping the bookmark", () => {
    renderWithI18n(<OfferDetailView offer={offer({ id: "o1" })} imageUrls={{}} related={[]} locale="en" t={t} canRfq={false} showRfq={false} orgId={null} rfqHref="/x" />, "en");
    expect(screen.queryByTestId("offer-request-quote")).toBeNull();
    expect(screen.getByTestId("offer-save")).toBeTruthy();
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
  it("offers all eight audience groups, every one selectable, none marked coming soon", () => {
    render();
    const ids = ["showroom", "supplier", "manufacturer", "importer", "contractor", "engineer", "craftsman", "customer"];
    for (const id of ids) expect((screen.getByTestId(`offer-audience-${id}`) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("offer-audience-groups").querySelectorAll("button")).toHaveLength(8);
    expect(document.body.textContent).not.toMatch(/Soon|قريب/);
  });
  it("stores each chosen group as its explicit canonical audience rows", () => {
    render();
    for (const id of ["importer", "contractor", "engineer", "craftsman", "customer"]) fireEvent.click(screen.getByTestId(`offer-audience-${id}`));
    expect([...document.querySelectorAll('input[name="audience"]')].map((i) => (i as HTMLInputElement).value)).toEqual([
      "importer", "contractor_company", "contractor", "design_office", "engineer", "interior_designer", "installer_technician", "end_consumer",
    ]);
  });
  it("restores the groups of a stored offer from its canonical rows", () => {
    render({ audiences: ["supplier", "design_office"] });
    expect(screen.getByTestId("offer-audience-supplier").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("offer-audience-engineer").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("offer-audience-importer").getAttribute("aria-checked")).toBe("false");
  });
  it("counts the description in words inside the textarea, accepts 250 and flags 251", () => {
    render();
    const area = screen.getByTestId("offer-description-input") as HTMLTextAreaElement;
    const counter = screen.getByTestId("offer-description-counter");
    expect(counter.textContent).toContain("0/250");
    expect(area.parentElement?.contains(counter)).toBe(true);
    fireEvent.change(area, { target: { value: "وصف عربي قصير" } });
    expect(counter.textContent).toContain("3/250");
    fireEvent.change(area, { target: { value: "سعر special 5 كلمات" } });
    expect(counter.textContent).toContain("4/250");
    fireEvent.change(area, { target: { value: Array.from({ length: 250 }, () => "كلمة").join(" ") } });
    expect(counter.textContent).toContain("250/250");
    expect(area.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(area, { target: { value: Array.from({ length: 251 }, () => "word").join(" ") } });
    expect(counter.textContent).toContain("251/250");
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("The offer description is up to 250 words.")).toBeTruthy();
  });
  it("lays the desktop builder out as a fixed preview beside an editor that scrolls on its own", () => {
    render();
    expect(screen.getByTestId("offer-editor-scroll").className).toMatch(/desktop:overflow-y-auto/);
    expect(screen.getByTestId("offer-workspace").className).toMatch(/desktop:overflow-hidden/);
    expect(screen.getByTestId("offer-preview").className).toMatch(/desktop:min-h-0/);
  });
  it("tracks completeness live", () => {
    render({ title: "Pack", totalPrice: "100", items: [{ productId: products[0]!.id, quantity: 1 }] });
    const done = [...screen.getByTestId("offer-completeness").querySelectorAll("li")].map((li) => li.getAttribute("data-done"));
    expect(done).toEqual(["true", "true", "true", "true", "false"]);
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
