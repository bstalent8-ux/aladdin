import { IDENTITIES } from "../helpers/auth";
import { psql, signedInClient } from "./setup";

const q = (s: string) => psql(s).trim();

type Org = { organization_id: string; kind: string };
export async function orgOf(email: string): Promise<string> {
  const c = await signedInClient(email);
  const ws = (await c.rpc("my_workspaces")).data as Org[];
  return ws.find((w) => w.kind === "business")!.organization_id;
}

export async function ok<T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.code} ${error.message}`);
  return data;
}

/** Buyer (Showroom) sends a Direct RFQ to the Distributor, who opens a DRAFT quotation. Real RPCs only. */
export async function draftQuotation(): Promise<{ quotationId: string; rfqId: string }> {
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

/** A SUBMITTED quotation (priced) ready for the buyer to decide. */
export async function submittedQuotation(): Promise<{ quotationId: string; rfqId: string }> {
  const made = await draftQuotation();
  const rania = await signedInClient(IDENTITIES.distributor);
  const item = q(`select id from public.quotation_items where quotation_id = '${made.quotationId}' limit 1`);
  await ok(rania.rpc("set_quotation_item_price", { p_item_id: item, p_unit_price: 80 }), "price");
  const v = Number(q(`select version from public.quotations where id = '${made.quotationId}'`));
  await ok(rania.rpc("submit_quotation", { p_quotation_id: made.quotationId, p_expected_version: v }), "submit_quotation");
  return made;
}

/** An ACCEPTED quotation (buyer decided through the real RPC), ready for an order. */
export async function acceptedQuotation(): Promise<{ quotationId: string; rfqId: string }> {
  const made = await submittedQuotation();
  const hana = await signedInClient(IDENTITIES.showroom);
  const v = Number(q(`select version from public.quotations where id = '${made.quotationId}'`));
  await ok(hana.rpc("decide_quotation", { p_quotation_id: made.quotationId, p_accept: true, p_expected_version: v }), "decide_quotation");
  return made;
}
