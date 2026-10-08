import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import type { SavedProductRow } from "@/server/queries/commerce";

const feed = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/server/actions/saved-feed", () => ({ loadSavedBatchAction: feed.load }));
vi.mock("@/server/actions/saved-products", () => ({ toggleSavedProductAction: vi.fn(async () => ({ ok: true })) }));

import { SavedGrid } from "./saved-grid";

const row = (i: number): SavedProductRow =>
  ({ product_id: `p${i}`, name: `Saved ${i}`, brand: null, category: "finishing", image_ref: null, short_description: null, note: null, supplier_name: "Supplier", supplier_verified: false, saved_at: "2026-10-01T00:00:00Z", organization_id: "o" }) as unknown as SavedProductRow;
const batch = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(from + i));
const mount = (rows: SavedProductRow[], total: number, category = "") =>
  renderWithI18n(<SavedGrid rows={rows} total={total} category={category} orgId="o" canRequestQuote />, "en");

beforeEach(() => feed.load.mockReset());

describe("Saved products — bounded batches", () => {
  it("shows the first batch with the total, then one batch per Show more at the right offset", async () => {
    mount(batch(0, 10), 23, "finishing");
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByTestId("saved-shown").textContent).toBe("Showing 10 of 23");
    feed.load.mockResolvedValueOnce({ ok: true, rows: batch(10, 10), total: 23 });
    fireEvent.click(screen.getByTestId("saved-show-more"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(20));
    expect(feed.load).toHaveBeenCalledWith("finishing", 10);
  });
  it("goes 10 -> 20 -> 23 and back one batch per Show less", async () => {
    mount(batch(0, 10), 23);
    feed.load.mockResolvedValueOnce({ ok: true, rows: batch(10, 10), total: 23 }).mockResolvedValueOnce({ ok: true, rows: batch(20, 3), total: 23 });
    fireEvent.click(screen.getByTestId("saved-show-more"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(20));
    fireEvent.click(screen.getByTestId("saved-show-more"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(23));
    fireEvent.click(screen.getByTestId("saved-show-less"));
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(screen.getByTestId("saved-show-less"));
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByTestId("saved-show-less")).toBeNull();
  });
  it("shows the empty state when nothing is saved", () => {
    mount([], 0);
    expect(screen.getByText("Nothing saved yet")).toBeTruthy();
  });
});
