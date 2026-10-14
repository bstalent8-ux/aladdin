"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { MARKETPLACE_IMAGE_BUCKET, parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import type { Json } from "@/types/database.types";

/**
 * Marketplace seller writers. Thin wrappers over the trusted SECURITY DEFINER
 * RPCs (Migration 06): authentication, organization membership, catalogue
 * authority, seller approval, ownership, validation, atomicity and the stock
 * ledger all live in the database. These actions run under the caller's OWN
 * session — no service credential is involved — and only translate a refusal
 * into a stable code the form can show.
 */
export type SellerResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const PRODUCTS_PATH = "/b2c/seller/products";

export type SavedProduct = {
  id: string;
  created: boolean;
  status: string;
  blockers: string[];
  variants: { id: string; sku: string; status: string }[];
};

function fail(error: { message?: string } | null): SellerActionError {
  return parseSellerError(error?.message);
}

export async function saveSellerProductAction(
  payload: Record<string, unknown>,
): Promise<SellerResult<SavedProduct>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_product_save", { p_payload: payload as Json });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as SavedProduct;
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, ...r };
}

export async function productReadinessAction(productId: string): Promise<SellerResult<{ blockers: string[] }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_product_readiness", { p_product_id: productId });
  if (error) return { ok: false, ...fail(error) };
  return { ok: true, blockers: (data ?? []) as string[] };
}

export async function publishProductAction(productId: string): Promise<SellerResult<{ status: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_product_publish", { p_product_id: productId });
  if (error) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, status: String(data) };
}

export async function ensureDefaultLocationAction(organizationId: string): Promise<SellerResult<{ locationId: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_default_location", { p_organization_id: organizationId });
  if (error || !data) return { ok: false, ...fail(error) };
  return { ok: true, locationId: data as string };
}

/**
 * One stock change through the ledger. `key` makes a repeated click a no-op;
 * `expectedOnHand`, when given, refuses the change if the stock moved since the
 * screen was drawn. The returned numbers are the SERVER's — the UI shows only these.
 */
export async function adjustStockAction(input: {
  variantId: string;
  locationId: string;
  delta: number;
  key: string;
  expectedOnHand?: number | null;
}): Promise<SellerResult<{ applied: boolean; onHand: number; reserved: number; available: number }>> {
  if (!Number.isInteger(input.delta) || input.delta === 0) return { ok: false, code: "delta_invalid" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_stock_adjust", {
    p_variant_id: input.variantId,
    p_location_id: input.locationId,
    p_delta: input.delta,
    p_idempotency_key: input.key,
    p_expected_on_hand: input.expectedOnHand ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { applied: boolean; on_hand: number; reserved: number; available: number };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, applied: r.applied, onHand: r.on_hand, reserved: r.reserved, available: r.available };
}

export async function requestImageUploadAction(
  productId: string,
  contentType: string,
  variantId?: string | null,
): Promise<SellerResult<{ imageId: string; objectKey: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_image_request_upload", {
    p_product_id: productId,
    p_content_type: contentType,
    p_variant_id: variantId ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { image_id: string; object_key: string };
  return { ok: true, imageId: r.image_id, objectKey: r.object_key };
}

/** Confirmed only if the database finds the bytes in storage. */
export async function confirmImageUploadAction(imageId: string): Promise<SellerResult<{ isPrimary: boolean }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_image_confirm_upload", { p_image_id: imageId });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, isPrimary: Boolean((data as { is_primary?: boolean }).is_primary) };
}

export async function updateImagesAction(
  productId: string,
  images: { id: string; sort_order: number; is_primary: boolean; variant_id: string | null }[],
): Promise<SellerResult<object>> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("marketplace_seller_images_update", {
    p_product_id: productId,
    p_images: images as unknown as Json,
  });
  if (error) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

/** Removes the image row, then deletes the bytes (allowed once nothing confirmed references them). */
export async function removeImageAction(imageId: string): Promise<SellerResult<object>> {
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("marketplace_seller_image_remove", { p_image_id: imageId });
  if (error) return { ok: false, ...fail(error) };
  if (key) await supabase.storage.from(MARKETPLACE_IMAGE_BUCKET).remove([key as string]);
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}
