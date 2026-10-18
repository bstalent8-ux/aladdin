import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { E2E_PASSWORD } from "../helpers/auth";

/**
 * Fixtures for the small-batch regression. Everything goes through the REAL interfaces a signed-in
 * user has (password sign-in, RPCs, Storage) - no service-role writes, no auth bypass - except two
 * things only a database administrator could do: stamping the known E2E password on the seeded
 * synthetic accounts (local test DB only) and creating the one extra synthetic account.
 *
 * Idempotent: re-running reuses what exists.
 */
export const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin_sr2";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:59321";
export const REG = {
  productCode: "REG-001",
  ownCode: "REG-002",
  ownName: "REG Showroom Own Product",
  productName: "REG Regression Tile",
  offerTitle: "REG Regression Offer",
  multiEmail: "reg-multi@example.test",
} as const;

const ALL_AUDIENCES = [
  "showroom_dealer",
  "supplier",
  "manufacturer",
  "importer",
  "contractor",
  "engineer",
  "installer_technician",
  "end_consumer",
];

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/** The local anon key, from the environment or the (git-ignored) frontend/.env.local. */
function anonKey(): string {
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const env = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const m = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m);
  if (!m) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  return m[1]!.trim();
}

export async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function supplierFixtures(): Promise<{ productId: string; offerId: string }> {
  const rania = await signedInClient("rania@example.test");
  const ws = await ok(rania.rpc("my_workspaces"), "my_workspaces");
  const org = (ws as Array<{ kind: string; organization_id: string }>).find((w) => w.kind === "business")!.organization_id;

  const existing = await ok(
    rania.from("products").select("id, version, status").eq("organization_id", org).eq("sku", REG.productCode).maybeSingle(),
    "find product",
  );
  let productId = (existing as { id: string } | null)?.id;
  if (!productId) {
    productId = (await ok(
      rania.rpc("own_product_create", { p_org_id: org, p_name: REG.productName, p_code: REG.productCode, p_category_code: "wallpaper", p_unit: "roll" }),
      "own_product_create",
    )) as string;
    const key = (await ok(rania.rpc("product_image_request_upload", { p_product_id: productId, p_content_type: "image/png" }), "request upload")) as string;
    const up = await rania.storage.from("product-images").upload(key, PNG, { contentType: "image/png" });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    await ok(rania.rpc("product_image_confirm_upload", { p_object_key: key }), "confirm upload");
    await ok(rania.rpc("product_audiences_set", { p_product_id: productId, p_audiences: ALL_AUDIENCES }), "audiences");
  }
  const p = (await ok(rania.from("products").select("version, status").eq("id", productId).single(), "product row")) as {
    version: number;
    status: string;
  };
  if (p.status !== "published") {
    await ok(rania.rpc("set_product_published", { p_product_id: productId, p_published: true, p_expected_version: p.version }), "publish");
  }

  const offerRow = await ok(
    rania.from("product_offers").select("id").eq("organization_id", org).eq("title", REG.offerTitle).maybeSingle(),
    "find offer",
  );
  let offerId = (offerRow as { id: string } | null)?.id;
  if (!offerId) {
    const saved = (await ok(
      rania.rpc("own_offer_save", {
        p_org_id: org,
        p_offer_id: null,
        p_expected_version: null,
        p_title: REG.offerTitle,
        p_description: "Regression offer",
        p_total_price: 100,
        p_reference_price: 150,
        p_starts_at: new Date(Date.now() - 60_000).toISOString(),
        p_ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        p_items: [{ product_id: productId, quantity: 2 }],
        p_audiences: ["showroom_dealer"],
      }),
      "own_offer_save",
    )) as { id: string; version: number };
    await ok(rania.rpc("own_offer_set_status", { p_offer_id: saved.id, p_action: "publish", p_expected_version: saved.version }), "publish offer");
    offerId = saved.id;
  }
  return { productId, offerId };
}

/** A draft product owned by the Showroom itself (for the product form, audiences and image upload). */
async function showroomOwnProduct(): Promise<string> {
  const hana = await signedInClient("hana@example.test");
  const ws = (await ok(hana.rpc("my_workspaces"), "my_workspaces")) as Array<{ kind: string; organization_id: string }>;
  const org = ws.find((w) => w.kind === "business")!.organization_id;
  const existing = await ok(
    hana.from("products").select("id").eq("organization_id", org).eq("sku", REG.ownCode).maybeSingle(),
    "find own product",
  );
  if (existing) return (existing as { id: string }).id;
  return (await ok(
    hana.rpc("own_product_create", { p_org_id: org, p_name: REG.ownName, p_code: REG.ownCode, p_category_code: "wallpaper", p_unit: "roll" }),
    "own_product_create (showroom)",
  )) as string;
}

/** A synthetic, email-confirmed account with the known E2E password (local test DB only). */
export function createSyntheticUser(email: string, persona: string): string {
  const id = psql(`select extensions.gen_random_uuid()`).trim();
  psql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
                            raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}',
            extensions.crypt('${E2E_PASSWORD}', extensions.gen_salt('bf')),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"REG Flow","locale":"en"}'::jsonb,
            now(), now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (extensions.gen_random_uuid(), '${id}', '${id}',
            jsonb_build_object('sub', '${id}', 'email', '${email}', 'email_verified', true),
            'email', now(), now(), now());
    update public.users set primary_account_type = '${persona}', status = 'active' where id = '${id}';
  `);
  return id;
}

/** One engineer with TWO approved organizations and ONE pending application (created through the real RPCs). */
async function multiOrgUser(): Promise<void> {
  const exists = psql(`select count(*) from auth.users where email = '${REG.multiEmail}'`).trim() !== "0";
  if (!exists) {
    // A synthetic, email-confirmed account with the known E2E password (local test DB only).
    psql(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
                              raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                              confirmation_token, recovery_token, email_change, email_change_token_new,
                              email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('9e900001-0000-4000-8000-0000000000e9', '00000000-0000-0000-0000-000000000000', 'authenticated',
              'authenticated', '${REG.multiEmail}', extensions.crypt('${E2E_PASSWORD}', extensions.gen_salt('bf')),
              '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"REG Multi","locale":"en"}'::jsonb,
              now(), now(), now(), '', '', '', '', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
      values (extensions.gen_random_uuid(), '9e900001-0000-4000-8000-0000000000e9', '9e900001-0000-4000-8000-0000000000e9',
              '{"sub":"9e900001-0000-4000-8000-0000000000e9","email":"${REG.multiEmail}","email_verified":true}'::jsonb,
              'email', now(), now(), now());
      update public.users set primary_account_type = 'engineer' where id = '9e900001-0000-4000-8000-0000000000e9';
    `);
  }
  const user = await signedInClient(REG.multiEmail);
  const admin = await signedInClient("admin@example.test");
  type App = { organization_id: string; name: string; application_status: string };
  const list = async () => (await ok(user.rpc("my_organization_applications"), "applications")) as App[];

  /** Approve an application through the real Admin RPCs (review_start -> review_approve). */
  const approve = async (orgId: string) => {
    const vid = psql(
      `select id from public.verifications where organization_id = '${orgId}' and subject_type = 'organization'
         and status in ('submitted', 'under_review') order by submitted_at desc limit 1`,
    ).trim();
    if (!vid) return;
    const status = psql(`select status from public.verifications where id = '${vid}'`).trim();
    if (status === "submitted") await ok(admin.rpc("review_start", { p_verification_id: vid }), "review_start");
    await ok(admin.rpc("review_approve", { p_verification_id: vid, p_grant_public_listing: false }), "review_approve");
  };

  const ensure = async (name: string, type: string, approved: boolean) => {
    let found = (await list()).find((a) => a.name === name);
    if (!found) {
      await ok(user.rpc("business_draft_save", { p_display_name: name, p_legal_name: `${name} LLC`, p_org_type: type }), "draft_save");
      const org = (await ok(user.rpc("business_draft_submit", { p_draft_id: null }), "draft_submit")) as string;
      await ok(user.rpc("organization_application_submit", { p_org_id: org }), "application_submit");
      found = (await list()).find((a) => a.name === name)!;
    }
    if (approved && found.application_status !== "approved") await approve(found.organization_id);
  };

  // The slot rule forces this order: the first must be approved before the next may open.
  await ensure("REG Engineering Office", "design_office", true);
  await ensure("REG Import House", "importer", true);
  await ensure("REG Pending Supply", "supplier", false);
}

export default async function globalSetup(): Promise<void> {
  psql(`
update auth.users
   set encrypted_password = extensions.crypt('${E2E_PASSWORD}', extensions.gen_salt('bf'))
 where email like '%@example.test' and coalesce(encrypted_password, '') = '';
`);
  const { productId, offerId } = await supplierFixtures();
  await multiOrgUser();
  process.env.REG_OWN_PRODUCT_ID = await showroomOwnProduct();
  process.env.REG_PRODUCT_ID = productId;
  process.env.REG_OFFER_ID = offerId;
}
