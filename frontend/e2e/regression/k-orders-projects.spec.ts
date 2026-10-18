import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql, signedInClient } from "./setup";
import { acceptedQuotation, ok } from "./commerce-fixtures";
import { prefs } from "./util";

/**
 * BATCH K (B3-A) - Orders and Projects through the real UI, authoritative backend.
 *
 * Implemented lifecycle (nothing invented): quotation accepted -> order `confirmed` -> `in_progress` (start) or
 * `cancelled` (cancel, confirmed only) -> project `planned` -> `active` -> `completed` (which completes the order).
 * Buyer = Showroom (hana), seller/executor = Distributor (rania). No payment, settlement or automatic cancellation exists.
 */
const q = (s: string) => psql(s).trim();
const orderOf = (qid: string) => q(`select id from public.orders where quotation_id = '${qid}'`);
const orderStatus = (id: string) => q(`select status from public.orders where id = '${id}'`);
const projectStatus = (id: string) => q(`select status from public.projects where id = '${id}'`);
const audit = (id: string, action: string) => Number(q(`select count(*) from public.audit_log where subject_id = '${id}' and action = '${action}'`));
const CONFLICT = /changed since you opened it/;

async function open(page: import("@playwright/test").Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
}

/** Sign out by dropping the session, restore the English locale preference, sign in as someone else. */
async function switchUser(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, email: string) {
  await page.context().clearCookies();
  await prefs(page, { locale: "en" });
  await signIn(page, request, email);
}

/** Buyer creates the order from an accepted quotation through the UI. Returns the order id. */
async function orderFromUi(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, qid: string): Promise<string> {
  await signIn(page, request, IDENTITIES.showroom);
  await open(page, `/b2b/quotations/${qid}`);
  await page.getByRole("button", { name: "Create order" }).click();
  await expect.poll(() => q(`select count(*) from public.orders where quotation_id = '${qid}'`), { timeout: 20_000 }).toBe("1");
  return orderOf(qid);
}

test.describe("orders and projects", () => {
  test.beforeEach(async ({ page }) => {
    await prefs(page, { locale: "en" });
  });

  test("K1 full lifecycle: buyer creates the order, seller starts it, creates, activates and completes the project", async ({ page, request }) => {
    test.setTimeout(240_000);
    const { quotationId } = await acceptedQuotation();
    const orderId = await orderFromUi(page, request, quotationId);
    expect(orderStatus(orderId)).toBe("confirmed");
    expect(audit(orderId, "order.created")).toBe(1);

    // BUYER view of a confirmed order: may cancel, may not start or create a project; sees the confirmed timeline.
    await open(page, `/b2b/orders/${orderId}`);
    await expect(page.getByRole("button", { name: "Start order" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create project" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /quotation/i }).first()).toBeVisible(); // linkage to the source quotation
    const buyerStart = await (await signedInClient(IDENTITIES.showroom)).rpc("start_order", {
      p_order_id: orderId,
      p_expected_version: Number(q(`select version from public.orders where id = '${orderId}'`)),
    });
    expect(buyerStart.error?.code, "the requester cannot start the order").toBe("42501");
    expect(orderStatus(orderId)).toBe("confirmed");

    // SELLER starts it.
    await switchUser(page, request, IDENTITIES.distributor);
    await open(page, `/b2b/orders/${orderId}`);
    await expect(page.getByRole("button", { name: "Start order" })).toBeVisible();
    await page.getByRole("button", { name: "Start order" }).click();
    await expect.poll(() => orderStatus(orderId), { timeout: 20_000 }).toBe("in_progress");
    expect(audit(orderId, "order.started")).toBe(1);
    await expect(page.getByRole("button", { name: "Start order" })).toHaveCount(0); // the page refreshed itself
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0); // a started order cannot be cancelled

    // SELLER creates the project from the started order.
    await page.getByLabel(/Project title|Title/i).first().fill("K1 Villa execution");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/b2b\/projects\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)![1]!;
    expect(projectStatus(projectId)).toBe("planned");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: /order/i }).first()).toBeVisible(); // project -> order linkage

    // ACTIVATE then COMPLETE.
    await page.getByRole("button", { name: "Activate project" }).click();
    await expect.poll(() => projectStatus(projectId), { timeout: 20_000 }).toBe("active");
    await expect(page.getByRole("button", { name: "Mark project completed" })).toBeVisible();
    await page.getByRole("button", { name: "Mark project completed" }).click();
    await expect.poll(() => projectStatus(projectId), { timeout: 20_000 }).toBe("completed");
    expect(orderStatus(orderId)).toBe("completed"); // completing the project completes its order
    for (const a of ["project.created", "project.activated", "project.completed"]) expect(audit(projectId, a), a).toBe(1);
    await expect(page.getByText("Execution is finished. Nothing further is required here.")).toBeVisible();

    // BUYER sees the finished project read-only: no lifecycle buttons.
    await switchUser(page, request, IDENTITIES.showroom);
    await open(page, `/b2b/projects/${projectId}`);
    await expect(page.getByRole("button", { name: /Activate project|Mark project completed/ })).toHaveCount(0);

    // HISTORY preserved: the quotation snapshot lines and the order lines are still there, the accepted quotation unchanged.
    expect(Number(q(`select count(*) from public.order_items where order_id = '${orderId}'`))).toBeGreaterThan(0);
    expect(q(`select status from public.quotations where id = '${quotationId}'`)).toBe("accepted");
  });

  test("K2 invalid transitions are refused by the database, with no state change and no browser hang", async () => {
    const { quotationId } = await acceptedQuotation();
    const hana = await signedInClient(IDENTITIES.showroom);
    const rania = await signedInClient(IDENTITIES.distributor);
    const created = await ok(hana.rpc("create_order_from_quotation", { p_quotation_id: quotationId }), "create order");
    const orderId = typeof created === "string" ? created : (created as { id: string }).id;
    const v = () => Number(q(`select version from public.orders where id = '${orderId}'`));

    // a second order for the same quotation
    expect((await hana.rpc("create_order_from_quotation", { p_quotation_id: quotationId })).error?.message).toMatch(/order already exists/i);
    expect(Number(q(`select count(*) from public.orders where quotation_id = '${quotationId}'`))).toBe(1);
    // a project from a merely-confirmed order
    expect((await rania.rpc("create_project_from_order", { p_order_id: orderId, p_title: "too early" })).error?.message).toMatch(/in-progress order/i);
    // an order from a quotation that is not accepted
    const submitted = await (await import("./commerce-fixtures")).submittedQuotation();
    expect((await hana.rpc("create_order_from_quotation", { p_quotation_id: submitted.quotationId })).error?.message).toMatch(/accepted quotation/i);

    await ok(rania.rpc("start_order", { p_order_id: orderId, p_expected_version: v() }), "start");
    expect((await rania.rpc("start_order", { p_order_id: orderId, p_expected_version: v() })).error?.message).toMatch(/only a confirmed order can be started/i);
    expect((await hana.rpc("cancel_order", { p_order_id: orderId })).error?.message).toMatch(/only a confirmed order can be cancelled/i);

    const proj = await ok(rania.rpc("create_project_from_order", { p_order_id: orderId, p_title: "K2 project" }), "create project");
    const projectId = typeof proj === "string" ? proj : (proj as { id: string }).id;
    const pv = () => Number(q(`select version from public.projects where id = '${projectId}'`));
    expect((await rania.rpc("create_project_from_order", { p_order_id: orderId, p_title: "dup" })).error?.message).toMatch(/project already exists/i);
    expect((await rania.rpc("complete_project", { p_project_id: projectId, p_expected_version: pv() })).error?.message).toMatch(/only an active project/i);
    // the buyer (not the executor) cannot advance the project
    expect((await hana.rpc("activate_project", { p_project_id: projectId, p_expected_version: pv() })).error?.code).toBe("42501");
    await ok(rania.rpc("activate_project", { p_project_id: projectId, p_expected_version: pv() }), "activate");
    expect((await rania.rpc("activate_project", { p_project_id: projectId, p_expected_version: pv() })).error?.message).toMatch(/only a planned project/i);
    await ok(rania.rpc("complete_project", { p_project_id: projectId, p_expected_version: pv() }), "complete");
    expect((await rania.rpc("activate_project", { p_project_id: projectId, p_expected_version: pv() })).error?.message).toMatch(/only a planned project/i);
    expect((await rania.rpc("complete_project", { p_project_id: projectId, p_expected_version: pv() })).error?.message).toMatch(/only an active project/i);
    expect(orderStatus(orderId)).toBe("completed");
    expect(projectStatus(projectId)).toBe("completed");
    expect(Number(q(`select count(*) from public.projects where order_id = '${orderId}'`))).toBe(1);
  });

  test("K3 cancel: a party cancels a confirmed order, history stays, nothing can restart it", async ({ page, request }) => {
    test.setTimeout(240_000);
    const { quotationId } = await acceptedQuotation();
    const orderId = await orderFromUi(page, request, quotationId);
    await open(page, `/b2b/orders/${orderId}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect.poll(() => orderStatus(orderId), { timeout: 20_000 }).toBe("cancelled");
    expect(audit(orderId, "order.cancelled")).toBe(1);
    await expect(page.getByRole("button", { name: /Cancel order|Start order/ })).toHaveCount(0);
    // history: the order, its lines and the accepted quotation still exist
    expect(Number(q(`select count(*) from public.order_items where order_id = '${orderId}'`))).toBeGreaterThan(0);
    expect(q(`select status from public.quotations where id = '${quotationId}'`)).toBe("accepted");
    const rania = await signedInClient(IDENTITIES.distributor);
    const v = Number(q(`select version from public.orders where id = '${orderId}'`));
    expect((await rania.rpc("start_order", { p_order_id: orderId, p_expected_version: v })).error?.message).toMatch(/only a confirmed order can be started/i);
    // the order list shows it as cancelled
    await open(page, "/b2b/orders");
    await expect(page.getByText(/cancelled/i).first()).toBeVisible();
  });

  test("K4 stale start: the seller gets the localized conflict within seconds and the order is untouched", async ({ page, request }) => {
    test.setTimeout(240_000);
    const { quotationId } = await acceptedQuotation();
    const hana = await signedInClient(IDENTITIES.showroom);
    const created = await ok(hana.rpc("create_order_from_quotation", { p_quotation_id: quotationId }), "create order");
    const orderId = typeof created === "string" ? created : (created as { id: string }).id;
    await signIn(page, request, IDENTITIES.distributor);
    await open(page, `/b2b/orders/${orderId}`);
    q(`update public.orders set version = version + 1 where id = '${orderId}'`); // a concurrent change after the page loaded
    const t0 = Date.now();
    await page.getByRole("button", { name: "Start order" }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - t0, "conflict must not wait for the 60 s gateway timeout").toBeLessThan(10_000);
    await expect(page.getByRole("button", { name: "Start order" })).toBeEnabled();
    expect(orderStatus(orderId)).toBe("confirmed");
    expect(audit(orderId, "order.started")).toBe(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Start order" }).click();
    await expect.poll(() => orderStatus(orderId), { timeout: 20_000 }).toBe("in_progress");
  });

  test("K5 cross-tenant isolation: an unrelated organization cannot open, read or change the order or project", async ({ page, request }) => {
    test.setTimeout(240_000);
    const { quotationId } = await acceptedQuotation();
    const hana = await signedInClient(IDENTITIES.showroom);
    const rania = await signedInClient(IDENTITIES.distributor);
    const created = await ok(hana.rpc("create_order_from_quotation", { p_quotation_id: quotationId }), "create order");
    const orderId = typeof created === "string" ? created : (created as { id: string }).id;
    const v = Number(q(`select version from public.orders where id = '${orderId}'`));
    await ok(rania.rpc("start_order", { p_order_id: orderId, p_expected_version: v }), "start");
    const proj = await ok(rania.rpc("create_project_from_order", { p_order_id: orderId, p_title: "K5 project" }), "project");
    const projectId = typeof proj === "string" ? proj : (proj as { id: string }).id;

    const other = await signedInClient(REG.multiEmail); // approved engineer with two unrelated organizations
    expect((await other.from("orders").select("id").eq("id", orderId)).data).toHaveLength(0);
    expect((await other.from("projects").select("id").eq("id", projectId)).data).toHaveLength(0);
    expect((await other.from("order_items").select("id").eq("order_id", orderId)).data).toHaveLength(0);
    expect((await other.rpc("cancel_order", { p_order_id: orderId })).error).not.toBeNull();
    expect((await other.rpc("activate_project", { p_project_id: projectId, p_expected_version: 1 })).error?.code).not.toBe("VC001");
    expect(orderStatus(orderId)).toBe("in_progress");

    // the same refusal in the browser: the page is not found, no data leaks
    await signIn(page, request, REG.multiEmail, /\/(home|b2b|preview)/);
    for (const route of [`/b2b/orders/${orderId}`, `/b2b/projects/${projectId}`]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("K5 project")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Start order|Cancel order|Activate project/ })).toHaveCount(0);
    }
  });
});
