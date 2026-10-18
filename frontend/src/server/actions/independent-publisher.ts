"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseAudienceCodes } from "@/features/showroom-shell/products/product-audiences";
import { SHARED_UNITS } from "@/features/commerce/constants";
import type { FormState } from "@/server/actions/sales-forms";
import type { Database } from "@/types/database.types";

/**
 * Writers for an independent professional's own publishing. No authorization decision is made here:
 * who may request approval, whether the approval is in force, who owns a product and what may be
 * published are decided by the trusted RPCs (`independent_publisher_request`, `publisher_product_create`,
 * `own_product_update`, `set_product_published`, `product_audiences_set`). The publisher id the screens send is
 * re-derived and re-checked on every call, so a forged id can only be refused.
 */
const uuid = z.string().uuid();
const ROOT = "/home/independent-publishing";

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function failure(error: { code?: string; hint?: string | null; message?: string }): FormState {
  if (error.hint === "not_approved" || error.code === "42501") return { ok: false, code: "independentPublishing.errors.notApproved" };
  if (error.hint === "not_eligible") return { ok: false, code: "independentPublishing.errors.notEligible" };
  if (error.hint === "suspended") return { ok: false, code: "independentPublishing.errors.suspended" };
  if (error.hint === "already_active") return { ok: false, code: "independentPublishing.errors.alreadyActive" };
  if (error.code === "23505") return { ok: false, code: "independentPublishing.errors.duplicateCode" };
  if (error.code === "22023") return { ok: false, code: "independentPublishing.errors.invalid" };
  if (error.code === "VC001" || error.code === "40001") return { ok: false, code: "states.staleConflict" };
  return { ok: false, code: "states.genericRetry" };
}

export async function requestIndependentPublishingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("independent_publisher_request", { p_note: field(fd, "note").slice(0, 500) });
  if (error) return failure(error);
  revalidatePath(ROOT);
  return { ok: true, code: "independentPublishing.requested" };
}

const createSchema = z.object({
  publisherId: uuid,
  name: z.string().min(2).max(160),
  code: z.string().min(1).max(60),
  categoryCode: z.string().min(1).max(60),
  unit: z.enum(SHARED_UNITS),
  price: z.coerce.number().positive().max(100000000),
});

export async function createIndependentProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = createSchema.safeParse({
    publisherId: field(fd, "publisherId"),
    name: field(fd, "name"),
    code: field(fd, "code"),
    categoryCode: field(fd, "categoryCode"),
    unit: field(fd, "unit"),
    price: field(fd, "price"),
  });
  if (!parsed.success) return { ok: false, code: "independentPublishing.errors.invalid" };
  const audiences = parseAudienceCodes(fd.getAll("audience"));
  if (!audiences.ok) return { ok: false, code: "independentPublishing.errors.invalid" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const created = await supabase.rpc("publisher_product_create", {
    p_publisher_id: v.publisherId,
    p_name: v.name,
    p_code: v.code,
    p_category_code: v.categoryCode,
    p_unit: v.unit as Database["public"]["Enums"]["product_unit"],
    p_base_price: v.price,
  });
  if (created.error) return failure(created.error);
  if (audiences.codes.length > 0) {
    const set = await supabase.rpc("product_audiences_set", { p_product_id: created.data as string, p_audiences: audiences.codes });
    if (set.error) return failure(set.error);
  }
  revalidatePath(ROOT);
  return { ok: true, code: "independentPublishing.created" };
}

export async function setIndependentProductPublishedAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuid.safeParse(field(fd, "productId"));
  const version = Number(field(fd, "version"));
  if (!id.success || !Number.isInteger(version)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("set_product_published", {
    p_product_id: id.data,
    p_published: field(fd, "publish") === "true",
    p_expected_version: version,
  });
  if (error) {
    if ((error.message ?? "").includes("audience")) return { ok: false, code: "independentPublishing.errors.needAudience" };
    return failure(error);
  }
  revalidatePath(ROOT);
  return { ok: true, code: "independentPublishing.updated" };
}
