import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { CATALOG_VIEW_COOKIE } from "@/lib/ui/catalog-view";

const actions = vi.hoisted(() => ({
  create: vi.fn(async () => ({ ok: false })),
  draft: vi.fn(),
  push: vi.fn(),
  update: vi.fn(async () => ({ ok: false })),
  lifecycle: vi.fn(async () => ({ ok: true })),
  requestUpload: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(async () => ({ ok: true })),
  reorder: vi.fn(async () => ({ ok: true })),
  upload: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  refresh: vi.fn(),
}));
vi.mock("@/server/actions/own-products", () => ({
  createOwnProductAction: actions.create,
  createOwnProductDraftAction: actions.draft,
  updateOwnProductAction: actions.update,
  ownProductLifecycleAction: actions.lifecycle,
  requestProductImageUploadAction: actions.requestUpload,
  confirmProductImageUploadAction: actions.confirm,
  removeProductImageAction: actions.remove,
  reorderProductImagesAction: actions.reorder,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh, push: actions.push }) }));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ storage: { from: () => ({ upload: actions.upload }) } }),
}));

import { OwnProductsResults, type OwnProductCard } from "./own-products-results";
import { ProductForm } from "./product-form";
import { ImageManager } from "./image-manager";

/** Hex literals are product DATA here, not styling — built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

const card = (over: Partial<OwnProductCard> & { id: string }): OwnProductCard => ({
  name: "Matt Emulsion 18L",
  code: "PNT-001",
  categoryCode: "paints",
  unit: "pail",
  status: "published",
  archivedAt: null,
  version: 2,
  imageUrl: null,
  sizeLabel: null,
  weightKg: null,
  colors: [],
  basePrice: null,
  ...over,
});

const products = [
  card({ id: "a" }),
  card({ id: "b", name: "Old tile", code: null, categoryCode: null, unit: "box", status: "draft" }),
  card({ id: "c", name: "Retired", status: "draft", archivedAt: "2026-10-08T00:00:00Z" }),
];

const wrap = (node: React.ReactNode, locale: "en" | "ar" = "en") =>
  render(<I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = `${CATALOG_VIEW_COOKIE}=; max-age=0; path=/`;
});

describe("OwnProductsResults", () => {
  const results = (props: Partial<React.ComponentProps<typeof OwnProductsResults>> = {}) =>
    wrap(<OwnProductsResults products={products} initialView="grid" countLabel="3 products" canWrite canPublish {...props} />);

  it("renders the grid by default and switches to a list that remembers the choice", () => {
    results();
    expect(screen.getByTestId("my-products-grid")).toBeTruthy();
    expect(screen.getAllByTestId("my-products-card")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("my-products-view-list"));
    expect(screen.getByTestId("my-products-list")).toBeTruthy();
    expect(screen.getAllByTestId("my-products-row")).toHaveLength(3);
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=list`);
  });

  it("starts as a list when that is the remembered preference", () => {
    results({ initialView: "list" });
    expect(screen.getByTestId("my-products-list")).toBeTruthy();
  });

  it("shows name, code, canonical category, unit and status", () => {
    results();
    const first = screen.getAllByTestId("my-products-card")[0]!;
    expect(within(first).getByText("Matt Emulsion 18L")).toBeTruthy();
    expect(within(first).getByText("PNT-001")).toBeTruthy();
    expect(within(first).getByText("Paints")).toBeTruthy();
    expect(within(first).getByText("Pail")).toBeTruthy();
    expect(within(first).getByText("Active")).toBeTruthy();
    expect(first.getAttribute("data-status")).toBe("active");
  });

  it("calls an unclassified historical product unclassified — it never borrows a canonical category", () => {
    results();
    const old = screen.getAllByTestId("my-products-card")[1]!;
    expect(within(old).getByText("Unclassified")).toBeTruthy();
    expect(within(old).getByText("Draft")).toBeTruthy();
    expect(within(old).getByText("Box")).toBeTruthy();
  });

  it("shows the on/off switch by state, and Restore only for an archived product", () => {
    results();
    const [active, inactive, archived] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(within(inactive!).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(within(archived!).queryByRole("switch")).toBeNull();
    expect(within(active!).getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(within(archived!).getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(within(archived!).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(archived!.getAttribute("data-status")).toBe("archived");
  });

  it("the switch submits the matching transition with the version", async () => {
    results();
    const [active, inactive] = screen.getAllByTestId("my-products-card");
    fireEvent.click(within(active!).getByRole("switch"));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(1));
    let sent = (actions.lifecycle.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect([sent.get("action"), sent.get("productId"), sent.get("expectedVersion")]).toEqual(["deactivate", "a", "2"]);
    fireEvent.click(within(inactive!).getByRole("switch"));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(2));
    sent = (actions.lifecycle.mock.calls[1] as unknown as [unknown, FormData])[1];
    expect(sent.get("action")).toBe("activate");
  });

  it("links each card to its editor and to its photos", () => {
    results();
    const [active] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("link", { name: "Manage photos" }).getAttribute("href")).toBe("/preview/showroom-suite-v2/my-products/a/edit#product-photos");
  });

  it("shows colors, size and weight when the product has them — and nothing it does not have", () => {
    const colors = ["Sand", "Warm White", "Grey", "Black", "Blue", "Green", "Red"].map((name, i) => ({ name, hex: i === 2 ? null : h("C9B28A") }));
    wrap(<OwnProductsResults products={[card({ id: "z", colors, sizeLabel: "60×60 cm", weightKg: 2.5, basePrice: 159.5 })]} initialView="grid" countLabel="1" canWrite canPublish />);
    const c = screen.getByTestId("my-products-card");
    // swatches, with the name as the accessible name; a sensible maximum plus "+N"
    expect(within(c).getAllByTestId("color-swatch")).toHaveLength(5);
    expect(within(c).getByRole("button", { name: "Sand" })).toBeTruthy();
    expect(within(c).getByRole("button", { name: /Grey — Color not set yet/ })).toBeTruthy();
    expect(within(c).getByText("+2")).toBeTruthy();
    expect(within(c).getByTestId("card-price").textContent).toContain("159.50 EGP");
    expect(within(c).getByText("Pail • 60×60 cm • 2.5 kg")).toBeTruthy();
    // only the base price is a price: no discount, offer or stock text is invented
    expect(c.textContent).not.toMatch(/discount|offer|stock|%/i);
  });

  it("does not offer Edit on an archived product (it must be restored first)", () => {
    results();
    const [active, , archived] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/preview/showroom-suite-v2/my-products/a/edit");
    expect(within(archived!).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("is read-only without the capabilities — no edit, no lifecycle buttons", () => {
    results({ canWrite: false, canPublish: false });
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Archive|Restore/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("publishing rights alone give the switch but not archive or edit", () => {
    results({ canWrite: false, canPublish: true });
    const [active] = screen.getAllByTestId("my-products-card");
    expect(within(active!).getByRole("switch")).toBeTruthy();
    expect(within(active!).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(within(active!).queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("asks before archiving, and says what it does", async () => {
    results();
    const [active] = screen.getAllByTestId("my-products-card");
    fireEvent.click(within(active!).getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Archive this product?")).toBeTruthy();
    expect(within(dialog).getByText(/cannot be edited until you restore it/)).toBeTruthy();
    expect(actions.lifecycle).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(actions.lifecycle).toHaveBeenCalledTimes(1));
    const submitted = (actions.lifecycle.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(submitted.get("action")).toBe("archive");
    expect(submitted.get("productId")).toBe("a");
    expect(submitted.get("expectedVersion")).toBe("2");
  });

  it("works in Arabic with Arabic labels", () => {
    wrap(<OwnProductsResults products={[products[0]!]} initialView="grid" countLabel="1 منتج" canWrite canPublish />, "ar");
    expect(screen.getAllByText("نشط").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "إدارة الصور" })).toBeTruthy();
    expect(screen.getAllByText("دهانات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("باستلة").length).toBeGreaterThan(0);
  });
});

describe("ProductForm", () => {
  const existing = {
    id: "p1",
    version: 4,
    name: "Old tile",
    code: "TILE-1",
    categoryCode: null,
    unit: "box",
    colors: [{ name: "Sand", hex: h("C9B28A") }],
    basePrice: null as number | null,
    weightKg: 2.5,
    sizeLabel: "60×60 cm",
    brand: "NileCeramics",
    description: "Glossy",
  };

  it("edit keeps the photo manager INSIDE the editor card, outside the <form> element, placed beside the colors", () => {
    const { container } = wrap(<ProductForm orgId="org-1" product={existing} photos={<div data-testid="photos-slot"><button type="button">Add</button></div>} />);
    const slot = screen.getByTestId("photos-slot");
    const form = screen.getByTestId("product-form");
    expect(form.contains(slot)).toBe(false);
    expect(slot.closest("#product-photos")).toBeTruthy();
    expect(container.querySelector("#product-photos")?.parentElement).toBe(form.parentElement);
  });

  it("create and edit lead with the name, then the code (the reference order)", () => {
    wrap(<ProductForm orgId="org-1" />);
    const name = screen.getByLabelText(/Product name/i);
    const code = screen.getByLabelText(/Product code/i);
    expect(name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the 15 canonical categories and the six required units", () => {
    wrap(<ProductForm orgId="org-1" />);
    fireEvent.click(screen.getByTestId("category-select"));
    expect(screen.getAllByRole("option")).toHaveLength(15);
    expect(screen.queryByRole("option", { name: /Unclassified/i })).toBeNull();
    fireEvent.keyDown(screen.getByTestId("category-select"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("unit-select"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toHaveLength(6);
  });

  it("carries the organization on create and the optimistic version on edit", () => {
    const { container, unmount } = wrap(<ProductForm orgId="org-1" />);
    expect((container.querySelector("input[name=orgId]") as HTMLInputElement).value).toBe("org-1");
    expect(container.querySelector("input[name=expectedVersion]")).toBeNull();
    unmount();
    const edit = wrap(<ProductForm orgId="org-1" product={existing} />);
    expect((edit.container.querySelector("input[name=expectedVersion]") as HTMLInputElement).value).toBe("4");
    expect((edit.container.querySelector("input[name=productId]") as HTMLInputElement).value).toBe("p1");
  });

  it("lets a historical product keep its own unit as an extra option, and starts it unclassified", () => {
    wrap(<ProductForm orgId="org-1" product={existing} />);
    expect(screen.getByTestId("unit-select").getAttribute("data-value")).toBe("box");
    fireEvent.click(screen.getByTestId("unit-select"));
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByTestId("category-select").getAttribute("data-value")).toBe("");
  });

  it("keeps weight and size as separate, labelled fields from the selling unit", () => {
    wrap(<ProductForm orgId="org-1" product={existing} />);
    expect((screen.getByLabelText(/Weight \(kg\)/) as HTMLInputElement).value).toBe("2.5");
    expect(screen.getByText(/separate from the unit the product is sold by/)).toBeTruthy();
    expect((screen.getByLabelText(/^Size/) as HTMLInputElement).value).toBe("60×60 cm");
  });

  const addColor = (name: string, hex: string) => {
    fireEvent.click(screen.getByTestId("add-color"));
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: hex } });
    fireEvent.change(screen.getByTestId("color-name"), { target: { value: name } });
    fireEvent.click(screen.getByTestId("color-save"));
  };
  const submitted = (container: HTMLElement) => JSON.parse((container.querySelector("input[name=colorItems]") as HTMLInputElement).value) as { name: string; hex: string | null }[];

  it("adds a color through the popover as a visible swatch, refuses a bad hex and a duplicate name, and removes it", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />);
    addColor("Warm White", h("f5f0e6"));
    addColor("Sand", h("C9B28A"));
    expect(submitted(container)).toEqual([{ name: "Warm White", hex: h("F5F0E6") }, { name: "Sand", hex: h("C9B28A") }]);
    expect(screen.getAllByTestId("color-swatch")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("add-color"));
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "red" } });
    fireEvent.change(screen.getByTestId("color-name"), { target: { value: "Red" } });
    fireEvent.click(screen.getByTestId("color-save"));
    expect(screen.getByRole("alert").textContent).toMatch(/not valid/);
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: h("FF0000") } });
    fireEvent.change(screen.getByTestId("color-name"), { target: { value: "sand" } });
    fireEvent.click(screen.getByTestId("color-save"));
    expect(screen.getByRole("alert").textContent).toMatch(/already added/);
    fireEvent.keyDown(screen.getByTestId("color-popover"), { key: "Escape" });
    expect(screen.queryByTestId("color-popover")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sand" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Sand" }));
    expect(submitted(container)).toEqual([{ name: "Warm White", hex: h("F5F0E6") }]);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("shows a swatch's name on hover/focus/click and keeps a legacy named color as an unset swatch", () => {
    wrap(<ProductForm orgId="org-1" product={{ ...existing, colors: [{ name: "Sand", hex: null }, { name: "Cream", hex: h("F2E9D8") }] }} />);
    const [legacy, cream] = screen.getAllByTestId("color-swatch");
    expect(legacy!.getAttribute("aria-label")).toMatch(/Sand — Color not set yet/);
    expect(cream!.getAttribute("aria-label")).toBe("Cream");
    expect(screen.getAllByTestId("color-tooltip").map((t) => t.textContent)).toEqual(["Sand", "Cream"]);
    fireEvent.click(cream!);
    expect(screen.getAllByTestId("color-tooltip")[1]!.className).toContain("block");
  });

  it("stops at twelve colors", () => {
    wrap(<ProductForm orgId="org-1" product={{ ...existing, colors: Array.from({ length: 12 }, (_, i) => ({ name: `Color ${i}`, hex: h("B96F52") })) }} />);
    expect((screen.getByTestId("add-color") as HTMLButtonElement).disabled).toBe(true);
  });

  it("stores Arabic color names verbatim", () => {
    const { container } = wrap(<ProductForm orgId="org-1" />, "ar");
    addColor("أبيض دافئ", h("F5F0E6"));
    expect(submitted(container)[0]!.name).toBe("أبيض دافئ");
  });

  it("counts description WORDS live inside the field, in both scripts, and flags more than 250", () => {
    wrap(<ProductForm orgId="org-1" />);
    const box = screen.getByLabelText(/^Description/) as HTMLTextAreaElement;
    expect(screen.getByTestId("description-count").textContent).toContain("0/250");
    fireEvent.change(box, { target: { value: "one two  three" } });
    expect(screen.getByTestId("description-count").textContent).toContain("3/250");
    fireEvent.change(box, { target: { value: "مرحبا بالعالم" } });
    expect(screen.getByTestId("description-count").textContent).toContain("2/250");
    fireEvent.change(box, { target: { value: Array.from({ length: 251 }, () => "w").join(" ") } });
    expect(screen.getByTestId("description-count").textContent).toContain("251/250");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.parentElement?.contains(screen.getByTestId("description-count"))).toBe(true);
  });

  it("offers a price field in EGP, prefilled on edit", () => {
    const { unmount } = wrap(<ProductForm orgId="org-1" />);
    expect(screen.getByTestId("price-input")).toBeTruthy();
    unmount();
    wrap(<ProductForm orgId="org-1" product={{ ...existing, basePrice: 159.5 }} />);
    expect((screen.getByTestId("price-input") as HTMLInputElement).value).toBe("159.5");
  });
});

describe("ImageManager", () => {
  const img = (n: number) => ({ id: `i${n}`, url: `https://signed/${n}.png`, slot: n });
  const manager = (images = [img(1), img(2)], archived = false) => wrap(<ImageManager productId="p1" productName="Matt Emulsion" images={images} archived={archived} />);
  const file = (type: string) => new File([new Uint8Array(16)], "x", { type });
  const pick = (input: HTMLElement, f: File) => fireEvent.change(input, { target: { files: [f] } });

  it("gives every photo a meaningful alt text and every control group a name", () => {
    manager();
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual(["Matt Emulsion — Photo 1", "Matt Emulsion — Photo 2"]);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Photo 1", "Photo 2"]);
    for (const b of screen.getAllByRole("button")) expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the count, marks the first photo as main, and offers one free slot", () => {
    manager();
    expect(screen.getByTestId("image-count").textContent).toBe("2 of 3 photos");
    expect(screen.getByText("Main photo")).toBeTruthy();
    expect(screen.getAllByTestId("image-add").filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it("offers no add control and says why when three photos exist", () => {
    manager([img(1), img(2), img(3)]);
    expect(screen.queryByTestId("image-add")).toBeNull();
    expect(screen.getByText("You have 3 photos. Remove one to add another.")).toBeTruthy();
  });

  it("takes no changes on an archived product", () => {
    manager([img(1)], true);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getAllByTestId("image-add").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("refuses a non-image before any request is made", () => {
    manager();
    pick(screen.getByTestId("image-input"), file("application/pdf"));
    expect(screen.getByText("Use a JPG, PNG or WebP image.")).toBeTruthy();
    expect(actions.requestUpload).not.toHaveBeenCalled();
  });

  it("uploads through ticket -> storage -> confirm, then refreshes", async () => {
    actions.requestUpload.mockResolvedValue({ ok: true, key: "org/p1/i9.png" });
    actions.confirm.mockResolvedValue({ ok: true, id: "i9" });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
    expect(actions.requestUpload).toHaveBeenCalledWith("p1", "image/png");
    expect(actions.upload).toHaveBeenCalledWith("org/p1/i9.png", expect.any(File), { contentType: "image/png", upsert: false });
    expect(actions.confirm).toHaveBeenCalledWith("org/p1/i9.png");
  });

  it("shows the three-photo refusal from the server and does not upload", async () => {
    actions.requestUpload.mockResolvedValue({ ok: false, code: "showroomProducts.errors.maxImages" });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    expect(await screen.findByText("A product can have at most 3 photos.")).toBeTruthy();
    expect(actions.upload).not.toHaveBeenCalled();
  });

  it("reports an upload failure without confirming", async () => {
    actions.requestUpload.mockResolvedValue({ ok: true, key: "org/p1/i9.png" });
    actions.upload.mockResolvedValueOnce({ error: { message: "denied" } });
    manager();
    pick(screen.getByTestId("image-input"), file("image/png"));
    expect(await screen.findByText("The photo could not be uploaded. Try again.")).toBeTruthy();
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("reorders by moving a photo earlier", async () => {
    manager([img(1), img(2), img(3)]);
    const second = screen.getAllByRole("group", { name: /Photo 2/ })[0]!;
    fireEvent.click(within(second).getByRole("button", { name: "Move earlier" }));
    await waitFor(() => expect(actions.reorder).toHaveBeenCalledWith("p1", ["i2", "i1", "i3"]));
  });

  it("cannot move the first photo earlier or the last later", () => {
    manager([img(1), img(2)]);
    expect((within(screen.getAllByRole("group", { name: /Photo 1/ })[0]!).getByRole("button", { name: "Move earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(screen.getAllByRole("group", { name: /Photo 2/ })[0]!).getByRole("button", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes a photo through the server action", async () => {
    manager();
    fireEvent.click(within(screen.getAllByRole("group", { name: /Photo 1/ })[0]!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("i1"));
  });
});

describe("Create product with photos in one flow", () => {
  const png = (name: string, type = "image/png") => new File([new Uint8Array(16)], name, { type });
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  const fill = (container: HTMLElement) => {
    fireEvent.change(container.querySelector("#name")!, { target: { value: "Matt Emulsion 18L" } });
    fireEvent.change(container.querySelector("#code")!, { target: { value: "PNT-001" } });
    fireEvent.change(container.querySelector("#categoryCode")!, { target: { value: "paints" } });
    fireEvent.change(container.querySelector("#unit")!, { target: { value: "pail" } });
  };
  const stage = (...files: File[]) => files.forEach((f) => fireEvent.change(screen.getByTestId("staged-input"), { target: { files: [f] } }));

  it("offers the photo slots on the create screen itself, before anything is saved", () => {
    wrap(<ProductForm orgId="org-1" />);
    expect(screen.getByTestId("staged-photos")).toBeTruthy();
    expect(screen.getByTestId("staged-count").textContent).toBe("0 of 3 photos");
  });

  it("shows photo counters with Latin digits in Arabic too (the Arabic zero reads as a dot)", () => {
    wrap(<ProductForm orgId="org-1" />, "ar");
    expect(screen.getByTestId("staged-count").textContent).toBe("0 من 3 صور");
  });

  it("does not show staged photos when editing (that screen has the live image manager)", () => {
    wrap(<ProductForm orgId="org-1" product={{ id: "p1", version: 1, name: "A product", code: "A1", categoryCode: "paints", unit: "pail", colors: [], basePrice: null, weightKg: null, sizeLabel: null, brand: null, description: null }} />);
    expect(screen.queryByTestId("staged-photos")).toBeNull();
  });

  it("stages locally without any request: nothing is uploaded until the form is submitted", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("a.png"), png("b.png"));
    expect(screen.getByTestId("staged-count").textContent).toBe("2 of 3 photos");
    expect(actions.draft).not.toHaveBeenCalled();
    expect(actions.requestUpload).not.toHaveBeenCalled();
    expect(actions.upload).not.toHaveBeenCalled();
  });

  it("refuses a non-image or an oversize file, and stops at three", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("doc.pdf", "application/pdf"));
    expect(screen.getByText("Use a JPG, PNG or WebP image.")).toBeTruthy();
    stage(png("1.png"), png("2.png"), png("3.png"), png("4.png"));
    expect(screen.getByTestId("staged-count").textContent).toBe("3 of 3 photos");
    expect(screen.queryByTestId("staged-add")).toBeNull();
  });

  it("reorders and removes staged photos before saving", () => {
    wrap(<ProductForm orgId="org-1" />);
    stage(png("a.png"), png("b.png"));
    const second = screen.getAllByRole("group", { name: /Photo 2/ })[0]!;
    fireEvent.click(within(second).getByRole("button", { name: "Move earlier" }));
    fireEvent.click(within(screen.getAllByRole("group", { name: /Photo 2/ })[0]!).getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("staged-count").textContent).toBe("1 of 3 photos");
  });

  it("creates the draft, uploads the staged photos in order, then goes to the product", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    actions.requestUpload.mockImplementation(async () => ({ ok: true, key: "org/p-new/i.png" }));
    actions.confirm.mockResolvedValue({ ok: true, id: "i1" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("first.png"), png("second.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/preview/showroom-suite-v2/my-products/p-new/edit?created=1"));
    expect(actions.requestUpload).toHaveBeenCalledTimes(2);
    const uploaded = actions.upload.mock.calls.map((c) => (c as unknown as [string, File])[1].name);
    expect(uploaded).toEqual(["first.png", "second.png"]);
    const sent = (actions.draft.mock.calls[0] as unknown as [FormData])[0];
    expect(sent.get("orgId")).toBe("org-1");
    expect(sent.get("name")).toBe("Matt Emulsion 18L");
  });

  it("keeps the user on the screen with the field error when the product is refused — and uploads nothing", async () => {
    actions.draft.mockResolvedValue({ ok: false, fieldErrors: { code: "showroomProducts.errors.duplicateCode" } });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("a.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    expect(await screen.findByText("This product code is already used in your business.")).toBeTruthy();
    expect(actions.requestUpload).not.toHaveBeenCalled();
    expect(actions.push).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector("#code")));
  });

  it("still lands on the new draft, flagged, when a photo upload fails (nothing is lost, nothing orphaned)", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    actions.requestUpload.mockResolvedValue({ ok: false, code: "showroomProducts.images.errorUpload" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    stage(png("a.png"));
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/preview/showroom-suite-v2/my-products/p-new/edit?created=1&photos=partial"));
  });

  it("creates without photos just as before", async () => {
    actions.draft.mockResolvedValue({ ok: true, productId: "p-new" });
    const { container } = wrap(<ProductForm orgId="org-1" />);
    fill(container);
    fireEvent.submit(screen.getByTestId("product-form"));
    await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/preview/showroom-suite-v2/my-products/p-new/edit?created=1"));
    expect(actions.requestUpload).not.toHaveBeenCalled();
  });
});
