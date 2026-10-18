import { appendFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql, signedInClient } from "./setup";
import { ok, orgOf } from "./commerce-fixtures";
import { prefs } from "./util";

/**
 * BATCH O (B2, Option C) - every deterministic stale-version guard answers at once with VC001 / HTTP 400.
 *
 * Before the fix a stale call was treated by PostgREST as a retryable serialization failure (SQLSTATE 40001) and
 * re-run until the gateway timed out (60 s, 504); five representative calls were measured hanging past an 8 s abort.
 * Representatives from each family: products, offers, sales (leads, customers, follow-ups), jobs, purchase requests,
 * plus one real browser journey (Showroom product edit in a stale tab). No deferred frontend feature is enabled:
 * purchase requests have no screen and are exercised through the API only.
 */
const q = (s: string) => psql(s).trim();
const FAST_MS = 5_000;
const STALE = 99_999;
const OUT = process.env.VC_TIMINGS;
const auditCount = () => Number(q("select count(*) from public.audit_log"));

type Result = { error: { code?: string; message?: string } | null; status: number };

/** A member of the organization who is allowed to make the call (the first answer that is not a permission refusal). */
async function asMember(org: string, call: (c: SupabaseClient) => PromiseLike<Result>, label: string): Promise<Result> {
  const emails = q(`select u.email from public.memberships m join auth.users u on u.id = m.user_id where m.organization_id = '${org}' and m.status = 'active' order by m.created_at limit 8`).split("\n").filter(Boolean);
  for (const email of emails) {
    const c = await signedInClient(email);
    const t0 = Date.now();
    const r = await Promise.race([
      Promise.resolve(call(c)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label}: no answer within ${FAST_MS} ms (retry storm)`)), FAST_MS)),
    ]);
    const ms = Date.now() - t0;
    if (r.error?.code === "42501" || r.error?.code === "P0002") continue;
    if (OUT) appendFileSync(OUT, `${label} | ${ms} ms | HTTP ${r.status} | ${r.error?.code ?? "ok"}\n`);
    expect(ms, `${label} answered within ${FAST_MS} ms`).toBeLessThan(FAST_MS);
    return r;
  }
  throw new Error(`${label}: no member of ${org} was authorized`);
}
const expectConflict = (r: Result, label: string) => {
  expect(r.error?.code, `${label} code`).toBe("VC001");
  expect(r.status, `${label} HTTP status`).toBe(400);
  expect(r.error?.message ?? "", `${label} message`).toMatch(/modified concurrently/);
};

test.describe("version conflicts", () => {
  test("O1 products: stale edit, publish and archive are refused at once and change nothing", async () => {
    const id = q(`select id from public.products where sku = '${REG.ownCode}'`);
    const org = q(`select organization_id from public.products where id = '${id}'`);
    const snapshot = () => q(`select version || '|' || name || '|' || status from public.products where id = '${id}'`);
    const before = snapshot();
    const audit = auditCount();
    const edit = await asMember(org, (c) => c.rpc("own_product_update", { p_product_id: id, p_expected_version: STALE, p_name: "Stale writer", p_code: REG.ownCode, p_category_code: "paints", p_unit: "gallon" }), "own_product_update");
    expectConflict(edit, "own_product_update");
    expectConflict(await asMember(org, (c) => c.rpc("set_product_published", { p_product_id: id, p_published: true, p_expected_version: STALE }), "set_product_published"), "set_product_published");
    expectConflict(await asMember(org, (c) => c.rpc("own_product_set_archived", { p_product_id: id, p_archived: true, p_expected_version: STALE } as never), "own_product_set_archived"), "own_product_set_archived");
    expect(snapshot(), "nothing changed").toBe(before);
    expect(auditCount(), "no audit row for a refused call").toBe(audit);
  });

  test("O2 offers: stale status change and stale edit are refused at once", async () => {
    const row = q(`select id || '|' || organization_id from public.product_offers where title = '${REG.offerTitle}' limit 1`).split("|");
    const [id, org] = [row[0]!, row[1]!];
    const before = q(`select version || '|' || status from public.product_offers where id = '${id}'`);
    expectConflict(await asMember(org, (c) => c.rpc("own_offer_set_status", { p_offer_id: id, p_action: "pause", p_expected_version: STALE }), "own_offer_set_status"), "own_offer_set_status");
    const product = q(`select product_id from public.product_offer_items where offer_id = '${id}' limit 1`);
    expectConflict(
      await asMember(org, (c) => c.rpc("own_offer_save", { p_org_id: org, p_offer_id: id, p_expected_version: STALE, p_title: "Stale edit", p_description: null, p_total_price: 100, p_reference_price: null, p_starts_at: new Date().toISOString(), p_ends_at: new Date(Date.now() + 86_400_000).toISOString(), p_items: [{ product_id: product, quantity: 1 }], p_audiences: ["importer"] } as never), "own_offer_save"),
      "own_offer_save",
    );
    expect(q(`select version || '|' || status from public.product_offers where id = '${id}'`)).toBe(before);
  });

  test("O3 sales: stale lead, customer and follow-up writes are refused at once", async () => {
    const lead = q(`select id || '|' || organization_id from public.leads limit 1`).split("|");
    const cust = q(`select id || '|' || organization_id from public.customers limit 1`).split("|");
    const before = q(`select (select string_agg(version::text || stage::text, ',' order by id) from public.leads) || '/' || (select string_agg(updated_at::text, ',' order by id) from public.customers)`);
    const audit = auditCount();
    expectConflict(await asMember(lead[1]!, (c) => c.rpc("transition_lead", { p_lead_id: lead[0], p_expected_version: STALE, p_new_stage: "qualified" } as never), "transition_lead"), "transition_lead");
    expectConflict(await asMember(lead[1]!, (c) => c.rpc("update_lead_details", { p_lead_id: lead[0], p_expected_version: STALE, p_title: "Stale" } as never), "update_lead_details"), "update_lead_details");
    expectConflict(await asMember(cust[1]!, (c) => c.rpc("update_customer", { p_customer_id: cust[0], p_expected_updated_at: "2000-01-01T00:00:00Z", p_display_name: "Stale" } as never), "update_customer"), "update_customer");
    const fu = q(`select id || '|' || organization_id from public.follow_up_tasks limit 1`).split("|");
    if (fu[0]) expectConflict(await asMember(fu[1]!, (c) => c.rpc("update_follow_up", { p_follow_up_id: fu[0], p_expected_version: STALE, p_title: "Stale" } as never), "update_follow_up"), "update_follow_up");
    expect(q(`select (select string_agg(version::text || stage::text, ',' order by id) from public.leads) || '/' || (select string_agg(updated_at::text, ',' order by id) from public.customers)`), "nothing changed").toBe(before);
    expect(auditCount()).toBe(audit);
  });

  test("O4 jobs: stale publish, edit, close and cancel by the poster are refused at once", async () => {
    const poster = q(`select u.email from auth.users u where u.id = '70000006-0000-4000-8000-000000000006'`);
    const c = await signedInClient(poster);
    const timed = async (label: string, p: PromiseLike<Result>) => {
      const t0 = Date.now();
      const r = await p;
      if (OUT) appendFileSync(OUT, `${label} | ${Date.now() - t0} ms | HTTP ${r.status} | ${r.error?.code ?? "ok"}\n`);
      expect(Date.now() - t0, label).toBeLessThan(FAST_MS);
      expectConflict(r, label);
    };
    const draft = q(`select id from public.jobs where status = 'draft' limit 1`);
    const open = q(`select id from public.jobs where status = 'open' limit 1`);
    const before = q(`select string_agg(id || ':' || status || ':' || version, ',' order by id) from public.jobs`);
    await timed("job_publish", c.rpc("job_publish", { p_job_id: draft, p_expected_version: STALE }));
    await timed("job_update", c.rpc("job_update", { p_job_id: draft, p_expected_version: STALE, p_title: "Stale", p_trade_key: "wallpaper_installation", p_offered_amount: 100 }));
    await timed("job_close", c.rpc("job_close", { p_job_id: open, p_expected_version: STALE }));
    await timed("job_cancel", c.rpc("job_cancel", { p_job_id: open, p_expected_version: STALE, p_reason: "Stale" } as never));
    expect(q(`select string_agg(id || ':' || status || ':' || version, ',' order by id) from public.jobs`), "no job changed").toBe(before);
  });

  test("O5 purchase requests (API only, no screen): stale edit and stale publish are refused at once, no duplicate", async () => {
    const org = await orgOf(IDENTITIES.showroom);
    const hana = await signedInClient(IDENTITIES.showroom);
    const title = `O5 request ${Date.now().toString(36)}`;
    const created = await ok(hana.rpc("purchase_request_save", { p_org_id: org, p_request_id: null, p_expected_version: null, p_title: title, p_notes: null, p_needed_by: null, p_share_with_showrooms: false, p_items: [{ name: "Cornice", category_code: "cornices", quantity: 5, unit: "meter" }] } as never), "create draft");
    const id = typeof created === "string" ? created : (created as { id: string }).id;
    const version = Number(q(`select version from public.purchase_requests where id = '${id}'`));
    const audit = auditCount();
    expectConflict(await hana.rpc("purchase_request_save", { p_org_id: org, p_request_id: id, p_expected_version: STALE, p_title: "Stale", p_notes: null, p_needed_by: null, p_share_with_showrooms: false, p_items: [{ name: "Cornice", category_code: "cornices", quantity: 5, unit: "meter" }] } as never), "purchase_request_save");
    expectConflict(await hana.rpc("purchase_request_publish", { p_request_id: id, p_expected_version: STALE } as never), "purchase_request_publish");
    expect(q(`select version || '|' || title || '|' || status from public.purchase_requests where id = '${id}'`)).toBe(`${version}|${title}|draft`);
    expect(q(`select count(*) from public.purchase_requests where title = '${title}'`), "no duplicate request").toBe("1");
    expect(auditCount(), "no audit row for refused calls").toBe(audit);
  });

  test("O6 browser: a Showroom product edited in a stale tab shows the localized conflict within seconds and keeps the winner's data", async ({ page, request }) => {
    test.setTimeout(240_000);
    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
    const id = q(`select id from public.products where sku = '${REG.ownCode}'`);
    await page.goto(`/showroom/my-products/${id}/edit`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#name")).toHaveValue(REG.ownName);

    // another writer saves first (real RPC, current version)
    const hana = await signedInClient(IDENTITIES.showroom);
    const version = Number(q(`select version from public.products where id = '${id}'`));
    const winner = `${REG.ownName} (winner)`;
    const row = q(`select category_code || '|' || unit from public.products where id = '${id}'`).split("|");
    await ok(hana.rpc("own_product_update", { p_product_id: id, p_expected_version: version, p_name: winner, p_code: REG.ownCode, p_category_code: row[0], p_unit: row[1] } as never), "winning edit");

    // the stale tab now saves
    await page.locator("#name").fill(`${REG.ownName} (loser)`);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/changed since you opened it/i).first()).toBeVisible({ timeout: 15_000 });
    const ms = Date.now() - t0;
    if (OUT) appendFileSync(OUT, `browser product edit conflict shown | ${ms} ms\n`);
    expect(ms).toBeLessThan(15_000);
    expect(q(`select name from public.products where id = '${id}'`), "the winner's data is intact").toBe(winner);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

    // restore the fixture name for the other batches
    const v2 = Number(q(`select version from public.products where id = '${id}'`));
    await ok(hana.rpc("own_product_update", { p_product_id: id, p_expected_version: v2, p_name: REG.ownName, p_code: REG.ownCode, p_category_code: row[0], p_unit: row[1] } as never), "restore name");
  });
});
