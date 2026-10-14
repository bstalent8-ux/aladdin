import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql, signedInClient } from "./setup";
import { prefs } from "./util";

/**
 * BATCH J (B2) - stale quotation conflict.
 *
 * A stale expected_version used to raise SQLSTATE 40001, which PostgREST re-runs in a tight loop until the
 * gateway answers 504 after 60 s. It is now the business-conflict code VC001 (HTTP 400, immediate).
 * These tests drive the real browser and the real PostgREST path; none of them waits more than a few seconds.
 */
const q = (s: string) => psql(s).trim();
const CONFLICT = /changed since you opened it|تم تعديل/;

type Org = { organization_id: string; kind: string };
async function orgOf(email: string): Promise<string> {
  const c = await signedInClient(email);
  const ws = (await c.rpc("my_workspaces")).data as Org[];
  return ws.find((w) => w.kind === "business")!.organization_id;
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.code} ${error.message}`);
  return data;
}

/** Buyer (Showroom) sends a Direct RFQ to the Distributor, who opens a DRAFT quotation. Real RPCs only. */
async function draftQuotation(): Promise<{ quotationId: string; rfqId: string }> {
  const hana = await signedInClient(IDENTITIES.showroom);
  const rania = await signedInClient(IDENTITIES.distributor);
  const rfqId = (await ok(
    hana.rpc("create_rfq", {
      p_requester_org_id: await orgOf(IDENTITIES.showroom),
      p_supplier_org_id: await orgOf(IDENTITIES.distributor),
      p_title: `REG B2 ${Date.now().toString(36)}`,
    }),
    "create_rfq",
  )) as string;
  await ok(hana.rpc("add_rfq_item", { p_rfq_id: rfqId, p_product_id: process.env.REG_PRODUCT_ID, p_quantity: 4 }), "add_rfq_item");
  const v = (await ok(hana.from("rfqs").select("version").eq("id", rfqId).single(), "rfq version")) as { version: number };
  await ok(hana.rpc("submit_rfq", { p_rfq_id: rfqId, p_expected_version: v.version }), "submit_rfq");
  const created = await ok(rania.rpc("create_quotation", { p_rfq_id: rfqId }), "create_quotation");
  const quotationId = typeof created === "string" ? created : (created as { id: string }).id;
  return { quotationId, rfqId };
}

const version = (id: string) => Number(q(`select version from public.quotations where id = '${id}'`));
const status = (id: string) => q(`select status from public.quotations where id = '${id}'`);
const auditCount = (id: string, action: string) => Number(q(`select count(*) from public.audit_log where subject_id = '${id}' and action = '${action}'`));

async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
}

test.describe("quotation conflict", () => {
  test.beforeEach(async ({ page }) => {
    await prefs(page, { locale: "en" });
  });

  test("J1 supplier saves prices and submits on the same page, no reload: no false conflict", async ({ page, request }) => {
    const { quotationId } = await draftQuotation();
    await signIn(page, request, IDENTITIES.distributor);
    await open(page, `/b2b/quotations/${quotationId}`);
    await page.getByLabel(/Unit price/i).first().fill("125");
    await page.getByRole("button", { name: "Save prices" }).click();
    await expect(page.getByText("Prices saved.")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Submit to requester" }).click();
    // Either it submits (page refreshed itself with the new version) or it reports a conflict quickly. Record which.
    const outcome = await expect
      .poll(() => status(quotationId), { timeout: 8_000 })
      .toBe("submitted")
      .then(() => "submitted", () => "not-submitted");
    test.info().annotations.push({ type: "J1-outcome", description: outcome });
    expect(outcome, "saving prices then submitting without a reload must work").toBe("submitted");
    expect(auditCount(quotationId, "quotation.submitted")).toBe(1);
  });

  test("J2 stale submit: the browser shows the localized conflict within seconds and leaves the loading state", async ({ page, request }) => {
    const { quotationId } = await draftQuotation();
    // price the line through the real RPC so the Submit button is available
    const rania = await signedInClient(IDENTITIES.distributor);
    const item = q(`select id from public.quotation_items where quotation_id = '${quotationId}' limit 1`);
    await ok(rania.rpc("set_quotation_item_price", { p_item_id: item, p_unit_price: 90 }), "price");
    await signIn(page, request, IDENTITIES.distributor);
    await open(page, `/b2b/quotations/${quotationId}`);
    const shown = version(quotationId);
    // someone else (another tab / colleague) changes the quotation after this page loaded
    await ok(rania.rpc("update_quotation", { p_quotation_id: quotationId, p_expected_version: shown, p_note: "edited elsewhere" }), "edit elsewhere");
    const t0 = Date.now();
    const button = page.getByRole("button", { name: "Submit to requester" });
    await button.click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 10_000 });
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "stale-submit-browser-ms", description: String(ms) });
    expect(ms, "conflict must surface in seconds, not after the 60 s gateway timeout").toBeLessThan(10_000);
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveText(/Saving/i);
    expect(status(quotationId)).toBe("draft");
    expect(auditCount(quotationId, "quotation.submitted")).toBe(0);
    expect(version(quotationId)).toBe(shown + 1); // only the other editor's change: nothing was overwritten
    // after a reload the same action works at the current version
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Submit to requester" }).click();
    await expect.poll(() => status(quotationId), { timeout: 15_000 }).toBe("submitted");
    expect(auditCount(quotationId, "quotation.submitted")).toBe(1);
  });

  test("J3 stale decision: the buyer gets the conflict, the quotation stays submitted, then accepts after reloading", async ({ page, request }) => {
    const { quotationId } = await draftQuotation();
    const rania = await signedInClient(IDENTITIES.distributor);
    const item = q(`select id from public.quotation_items where quotation_id = '${quotationId}' limit 1`);
    await ok(rania.rpc("set_quotation_item_price", { p_item_id: item, p_unit_price: 70 }), "price");
    await ok(rania.rpc("submit_quotation", { p_quotation_id: quotationId, p_expected_version: version(quotationId) }), "submit");
    await signIn(page, request, IDENTITIES.showroom);
    await open(page, `/b2b/quotations/${quotationId}`);
    q(`update public.quotations set version = version + 1 where id = '${quotationId}'`); // a concurrent change after the page loaded
    const t0 = Date.now();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 10_000 });
    test.info().annotations.push({ type: "stale-accept-browser-ms", description: String(Date.now() - t0) });
    expect(status(quotationId)).toBe("submitted");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => status(quotationId), { timeout: 15_000 }).toBe("accepted");
    expect(auditCount(quotationId, "quotation.accepted")).toBe(1);
  });

  test("J4 two real PostgREST requests with the same version: one wins, one is refused immediately (VC001, HTTP 400)", async () => {
    const { quotationId } = await draftQuotation();
    const rania = await signedInClient(IDENTITIES.distributor);
    const v = version(quotationId);
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      rania.rpc("update_quotation", { p_quotation_id: quotationId, p_expected_version: v, p_note: "writer A" }),
      rania.rpc("update_quotation", { p_quotation_id: quotationId, p_expected_version: v, p_note: "writer B" }),
    ]);
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "concurrent-update-ms", description: String(ms) });
    const results = [a, b];
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const refused = results.find((r) => r.error)!;
    expect(refused.error!.code).toBe("VC001");
    expect(refused.status).toBe(400);
    expect(ms).toBeLessThan(10_000);
    expect(version(quotationId)).toBe(v + 1);
    const note = q(`select note from public.quotations where id = '${quotationId}'`);
    expect(["writer A", "writer B"]).toContain(note); // exactly one writer's note, never a mix
  });

  test("J5 authorization is evaluated before the version: a buyer or another organization learns nothing from a stale call", async () => {
    const { quotationId } = await draftQuotation();
    const v = version(quotationId);
    const hana = await signedInClient(IDENTITIES.showroom); // the REQUESTER cannot edit the supplier's draft
    const other = await signedInClient(REG.multiEmail); // an unrelated organization member
    for (const [who, c] of [["requester", hana], ["unrelated org", other]] as const) {
      const stale = await c.rpc("update_quotation", { p_quotation_id: quotationId, p_expected_version: v - 1, p_note: "x" });
      expect(stale.error?.code, `${who} with a stale version`).not.toBe("VC001");
      expect(["42501", "P0002"], `${who} with a stale version`).toContain(stale.error?.code);
      const submit = await c.rpc("submit_quotation", { p_quotation_id: quotationId, p_expected_version: v });
      expect(submit.error, `${who} submit`).not.toBeNull();
      const visible = await c.from("quotations").select("id").eq("id", quotationId);
      expect((visible.data ?? []).length, `${who} cannot read the supplier's draft`).toBe(0);
    }
    expect(version(quotationId)).toBe(v);
    expect(status(quotationId)).toBe("draft");
  });

  test("J6 no duplicate business records after conflicts: one quotation per RFQ, no order until accepted", async () => {
    const { quotationId, rfqId } = await draftQuotation();
    const rania = await signedInClient(IDENTITIES.distributor);
    const again = await rania.rpc("create_quotation", { p_rfq_id: rfqId });
    expect(again.error?.message ?? "").toMatch(/live quotation already exists/i);
    expect(Number(q(`select count(*) from public.quotations where rfq_id = '${rfqId}'`))).toBe(1);
    expect(Number(q(`select count(*) from public.orders where quotation_id = '${quotationId}'`))).toBe(0);
  });
});
