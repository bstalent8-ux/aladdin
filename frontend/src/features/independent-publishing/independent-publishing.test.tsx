import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/independent-publisher", () => ({
  requestIndependentPublishingAction: vi.fn(),
  createIndependentProductAction: vi.fn(),
  setIndependentProductPublishedAction: vi.fn(),
}));

import { IndependentPublishing } from "./independent-publishing";
import { publishingState, type IndependentProductRow, type IndependentPublisherView } from "./model";

beforeEach(() => vi.clearAllMocks());

const view = (over: Partial<IndependentPublisherView> = {}): IndependentPublisherView => ({
  eligibleKind: "contractor",
  publisherId: null,
  status: null,
  displayName: null,
  requestStatus: null,
  reason: null,
  canRequest: true,
  ...over,
});

const product = (over: Partial<IndependentProductRow> = {}): IndependentProductRow => ({
  id: "p1",
  name: "Ind Tile",
  code: "IND-1",
  status: "draft",
  version: 2,
  unit: "roll",
  categoryCode: "wallpaper",
  archived: false,
  audiences: [],
  ...over,
});

describe("publishing state", () => {
  it("derives one state from the account and the review", () => {
    expect(publishingState(view())).toBe("can_request");
    expect(publishingState(view({ requestStatus: "pending_review", canRequest: false }))).toBe("pending_review");
    expect(publishingState(view({ requestStatus: "rejected" }))).toBe("rejected");
    expect(publishingState(view({ publisherId: "x", status: "active", canRequest: false }))).toBe("active");
    expect(publishingState(view({ publisherId: "x", status: "suspended", canRequest: false }))).toBe("suspended");
    expect(publishingState(view({ publisherId: "x", status: "revoked" }))).toBe("revoked");
    expect(publishingState(view({ eligibleKind: null, canRequest: false }))).toBe("not_eligible");
  });
});

describe("independent publishing screen", () => {
  it("before approval: a request, no products area, no publishing", () => {
    renderWithI18n(<IndependentPublishing view={view()} products={[]} categories={[]} />, "en");
    expect(screen.getByTestId("publishing-can_request")).toBeTruthy();
    expect(screen.getByRole("button", { name: en.independentPublishing.request })).toBeTruthy();
    expect(screen.queryByTestId("independent-products")).toBeNull();
    expect(screen.queryByRole("button", { name: en.independentPublishing.products.add })).toBeNull();
  });

  it("a pending request cannot be sent twice", () => {
    renderWithI18n(<IndependentPublishing view={view({ requestStatus: "pending_review", canRequest: false })} products={[]} categories={[]} />, "en");
    expect(screen.getByText(en.independentPublishing.state.pending_review)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.independentPublishing.request })).toBeNull();
  });

  it("a rejection shows the reviewer note and allows a new request", () => {
    renderWithI18n(<IndependentPublishing view={view({ requestStatus: "rejected", reason: "Licence missing." })} products={[]} categories={[]} />, "en");
    expect(screen.getByTestId("publishing-reason").textContent).toContain("Licence missing.");
    expect(screen.getByRole("button", { name: en.independentPublishing.request })).toBeTruthy();
  });

  it("an approved publisher manages products and is told it is not public yet", () => {
    renderWithI18n(
      <IndependentPublishing
        view={view({ publisherId: "pub1", status: "active", canRequest: false })}
        products={[product(), product({ id: "p2", name: "Live Tile", status: "published" })]}
        categories={[{ code: "wallpaper", labelEn: "Wallpaper", labelAr: "ورق حائط" }]}
      />,
      "en",
    );
    expect(screen.getByTestId("publishing-active")).toBeTruthy();
    expect(screen.getByText(en.independentPublishing.notPublicYet)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.independentPublishing.products.add })).toBeTruthy();
    expect(screen.getByTestId("ind-product-draft")).toBeTruthy();
    expect(screen.getByTestId("ind-product-published")).toBeTruthy();
    expect(screen.getByRole("button", { name: en.independentPublishing.products.publish })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.independentPublishing.products.unpublish })).toBeTruthy();
  });

  it("a suspended publisher has no write controls, only its history", () => {
    renderWithI18n(
      <IndependentPublishing
        view={view({ publisherId: "pub1", status: "suspended", reason: "Under investigation", canRequest: false })}
        products={[product()]}
        categories={[]}
      />,
      "en",
    );
    expect(screen.getByTestId("publishing-suspended")).toBeTruthy();
    expect(screen.getByTestId("publishing-reason").textContent).toContain("Under investigation");
    expect(screen.queryByRole("button", { name: en.independentPublishing.products.add })).toBeNull();
    expect(screen.queryByTestId("independent-products")).toBeNull();
  });

  it("a revoked publisher may ask again", () => {
    renderWithI18n(<IndependentPublishing view={view({ publisherId: "pub1", status: "revoked", reason: "Fraud" })} products={[]} categories={[]} />, "en");
    expect(screen.getByTestId("publishing-revoked")).toBeTruthy();
    expect(screen.getByRole("button", { name: en.independentPublishing.request })).toBeTruthy();
  });

  it("renders in Arabic", () => {
    renderWithI18n(<IndependentPublishing view={view()} products={[]} categories={[]} />, "ar");
    expect(screen.getByRole("heading", { name: ar.independentPublishing.title })).toBeTruthy();
    expect(screen.getByRole("button", { name: ar.independentPublishing.request })).toBeTruthy();
  });
});
