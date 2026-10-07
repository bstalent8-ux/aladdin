import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { CATALOG_VIEW_COOKIE } from "@/lib/ui/catalog-view";
import type { CatalogRow } from "@/server/queries/commerce";
import { CatalogResults } from "./catalog-results";

vi.mock("@/server/actions/saved-products", () => ({
  toggleSavedProductAction: vi.fn(async () => ({ ok: true })),
}));

const row = (over: Partial<CatalogRow> & { id: string }): CatalogRow => ({
  brand: "NileCeramics",
  category: "finishing",
  image_ref: null,
  name: "Porcelain Floor Tile 60x60",
  organization_id: "org-s",
  published_at: "2026-10-01T00:00:00Z",
  short_description: null,
  sku: "TILE-1",
  supplier_name: "Cairo Ceramics Showroom",
  supplier_slug: "cairo",
  supplier_verified: true,
  unit: "square_meter",
  category_code: null,
  colors: [],
  weight_kg: null,
  size_label: null,
  primary_image_key: null,
  ...over,
});

const products = [row({ id: "p1" }), row({ id: "p2", name: "Marble Slab", brand: null, category: "construction", supplier_verified: false })];

function renderResults(props: Partial<React.ComponentProps<typeof CatalogResults>> = {}) {
  return render(
    <I18nProvider locale="en" dir="ltr">
      <CatalogResults products={products} orgId="org-1" savedIds={["p2"]} initialView="grid" countLabel="2 products" {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  document.cookie = `${CATALOG_VIEW_COOKIE}=; max-age=0; path=/`;
});

describe("showroom catalog results", () => {
  it("renders the grid by default, one card per product, and no price it does not have", () => {
    renderResults();
    expect(screen.getByTestId("showroom-catalog-grid")).toBeTruthy();
    expect(screen.getByTestId("showroom-catalog-grid").className).toMatch(/grid-cols-2.*tablet:grid-cols-3.*desktop:grid-cols-4.*wide:grid-cols-5/);
    expect(screen.queryByTestId("showroom-catalog-list")).toBeNull();
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(2);
    expect(screen.getByTestId("showroom-catalog-count").textContent).toBe("2 products");
    expect(document.body.textContent).not.toMatch(/EGP|ج\.م|price/i);
  });

  it("shows name, brand, category, supplier and unit on a card", () => {
    renderResults();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    expect(within(card).getByText("Porcelain Floor Tile 60x60")).toBeTruthy();
    expect(within(card).getByText("NileCeramics")).toBeTruthy();
    expect(within(card).getByText("Finishing")).toBeTruthy();
    expect(within(card).getByText("Cairo Ceramics Showroom")).toBeTruthy();
    expect(within(card).getByText("Square meter")).toBeTruthy();
  });

  it("opens the suite's own product detail, not the production catalog shell", () => {
    renderResults();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/preview/showroom-suite-v2/catalog/p1");
    expect(hrefs.some((h) => h?.startsWith("/b2b"))).toBe(false);
  });

  it("starts in list mode when the remembered preference is list", () => {
    renderResults({ initialView: "list" });
    expect(screen.getByTestId("showroom-catalog-list")).toBeTruthy();
    expect(screen.queryByTestId("showroom-catalog-grid")).toBeNull();
    expect(screen.getAllByTestId("showroom-catalog-row")).toHaveLength(2);
  });

  it("switches between grid and list, remembers the choice, and reports the pressed state", () => {
    renderResults();
    fireEvent.click(screen.getByTestId("showroom-catalog-view-list"));
    expect(screen.getByTestId("showroom-catalog-list")).toBeTruthy();
    expect(screen.getByTestId("showroom-catalog-view-list").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("showroom-catalog-view-grid").getAttribute("aria-pressed")).toBe("false");
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=list`);

    fireEvent.click(screen.getByTestId("showroom-catalog-view-grid"));
    expect(screen.getByTestId("showroom-catalog-grid")).toBeTruthy();
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=grid`);
  });

  it("gives a list row a thumbnail slot, category, supplier, unit, save control and primary action", () => {
    renderResults({ initialView: "list" });
    const r = screen.getAllByTestId("showroom-catalog-row")[0]!;
    expect(within(r).getByText("Finishing")).toBeTruthy();
    expect(within(r).getByText("Cairo Ceramics Showroom")).toBeTruthy();
    expect(within(r).getByText("Square meter")).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Save product" })).toBeTruthy();
    expect(within(r).getByRole("link", { name: "View details" }).getAttribute("href")).toBe("/preview/showroom-suite-v2/catalog/p1");
  });

  it.each(["grid", "list"] as const)("reflects saved state per product in %s mode and keeps the control outside links", (initialView) => {
    renderResults({ initialView });
    const items = screen.getAllByTestId(initialView === "grid" ? "showroom-catalog-card" : "showroom-catalog-row");
    expect(within(items[0]!).getByRole("button", { name: "Save product" }).getAttribute("aria-pressed")).toBe("false");
    const saved = within(items[1]!).getByRole("button", { name: "Remove from saved" });
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(saved.closest("a")).toBeNull();
  });

  it("posts the active organization and product with the save form", () => {
    renderResults();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    const form = card.querySelector("form")!;
    expect((form.querySelector("input[name=orgId]") as HTMLInputElement).value).toBe("org-1");
    expect((form.querySelector("input[name=productId]") as HTMLInputElement).value).toBe("p1");
    expect((form.querySelector("input[name=saved]") as HTMLInputElement).value).toBe("0");
  });

  it("never renders a row the view could not describe", () => {
    renderResults({ products: [...products, row({ id: "p3", category: null })] });
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(2);
  });
});
