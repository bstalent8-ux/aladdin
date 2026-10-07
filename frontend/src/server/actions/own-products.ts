"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { isLifecycleAction, parseOwnProductForm } from "@/features/showroom-shell/products/product-input";
import { mapOwnProductError } from "@/features/showroom-shell/products/error-map";
import {
  PRODUCT_IMAGE_BUCKET,
  isProductImageContentType,
  isProductImageKey,
  type ProductImageErrorCode,
} from "@/lib/storage/product-images";
import type { Database } from "@/types/database.types";

/**
 * Server Actions for "منتجاتي". Every one forwards the CALLER's JWT to a
 * security-definer RPC that re-derives the actor from auth.uid(), checks
 * organization membership and catalog.write / catalog.publish, validates the data
 * again and audits the change. Nothing here decides authorization, and there is
 * no service-role client: a bug in this file cannot widen access.
 */

export type OwnProductFormState = {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
};

type ProductUnit = Database["public"]["Enums"]["product_unit"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MY_PRODUCTS = `${SHOWROOM_ROOT}/my-products`;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const int = (fd: FormData, key: string) => {
  const v = str(fd, key);
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) ? n : undefined;
};

/** Every place a product's data is shown must show the change on the next request. */
function revalidateProduct(productId?: string) {
  revalidatePath(MY_PRODUCTS);
  revalidatePath(`${SHOWROOM_ROOT}/catalog`);
  revalidatePath(`${SHOWROOM_ROOT}/home`);
  revalidatePath("/b2b/products");
  revalidatePath("/b2b/catalog");
  if (productId) {
    revalidatePath(`${MY_PRODUCTS}/${productId}/edit`);
    revalidatePath(`${SHOWROOM_ROOT}/catalog/${productId}`);
    revalidatePath(`/b2b/catalog/${productId}`);
  }
}

export async function createOwnProductAction(_prev: OwnProductFormState, fd: FormData): Promise<OwnProductFormState> {
  const orgId = str(fd, "orgId");
  if (!orgId || !UUID.test(orgId)) return { ok: false, code: "states.genericRetry" };
  const parsed = parseOwnProductForm(fd);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const v = parsed.value;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("own_product_create", {
    p_org_id: orgId,
    p_name: v.name,
    p_code: v.code,
    p_category_code: v.categoryCode,
    p_unit: v.unit as ProductUnit,
    p_colors: v.colors,
    ...(v.weightKg !== null ? { p_weight_kg: v.weightKg } : {}),
    ...(v.sizeLabel ? { p_size_label: v.sizeLabel } : {}),
    ...(v.brand ? { p_brand: v.brand } : {}),
    ...(v.description ? { p_description: v.description } : {}),
  });
  if (error || typeof data !== "string" || !UUID.test(data)) {
    const mapped = mapOwnProductError(error ?? new Error("invalid create_product result"));
    return mapped.field ? { ok: false, fieldErrors: { [mapped.field]: mapped.code } } : { ok: false, code: mapped.code };
  }
  revalidateProduct(data);
  redirect(`${MY_PRODUCTS}/${data}/edit?created=1`);
}

export async function updateOwnProductAction(_prev: OwnProductFormState, fd: FormData): Promise<OwnProductFormState> {
  const productId = str(fd, "productId");
  const version = int(fd, "expectedVersion");
  if (!productId || !UUID.test(productId) || version === undefined) return { ok: false, code: "states.genericRetry" };
  const parsed = parseOwnProductForm(fd, str(fd, "currentUnit") ?? null);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const v = parsed.value;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("own_product_update", {
    p_product_id: productId,
    p_expected_version: version,
    p_name: v.name,
    p_code: v.code,
    p_category_code: v.categoryCode,
    p_unit: v.unit as ProductUnit,
    p_colors: v.colors,
    ...(v.weightKg !== null ? { p_weight_kg: v.weightKg } : {}),
    ...(v.sizeLabel ? { p_size_label: v.sizeLabel } : {}),
    ...(v.brand ? { p_brand: v.brand } : {}),
    ...(v.description ? { p_description: v.description } : {}),
  });
  if (error) {
    const mapped = mapOwnProductError(error);
    return mapped.field ? { ok: false, fieldErrors: { [mapped.field]: mapped.code } } : { ok: false, code: mapped.code };
  }
  revalidateProduct(productId);
  redirect(`${MY_PRODUCTS}/${productId}/edit?saved=1`);
}

/** Activate / deactivate / archive / restore — one action, the database picks the rule. */
export async function ownProductLifecycleAction(_prev: OwnProductFormState, fd: FormData): Promise<OwnProductFormState> {
  const productId = str(fd, "productId");
  const version = int(fd, "expectedVersion");
  const action = str(fd, "action");
  if (!productId || !UUID.test(productId) || version === undefined || !isLifecycleAction(action)) {
    return { ok: false, code: "states.genericRetry" };
  }
  const supabase = await getServerSupabase();
  const { error } =
    action === "activate" || action === "deactivate"
      ? await supabase.rpc("set_product_published", {
          p_product_id: productId,
          p_published: action === "activate",
          p_expected_version: version,
        })
      : await supabase.rpc("own_product_set_archived", {
          p_product_id: productId,
          p_archived: action === "archive",
          p_expected_version: version,
        });
  if (error) return { ok: false, code: mapOwnProductError(error).code };
  revalidateProduct(productId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
export type ImageTicket = { ok: true; key: string } | { ok: false; code: string };
export type ImageResult = { ok: true } | { ok: false; code: string };
export type ImageConfirmResult = { ok: true; id: string } | { ok: false; code: string };

export async function requestProductImageUploadAction(productId: string, contentType: string): Promise<ImageTicket> {
  if (!UUID.test(productId) || !isProductImageContentType(contentType)) {
    return { ok: false, code: "showroomProducts.images.errorType" satisfies ProductImageErrorCode };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("product_image_request_upload", { p_product_id: productId, p_content_type: contentType });
  if (error || typeof data !== "string" || !isProductImageKey(data)) {
    const mapped = mapOwnProductError(error ?? new Error("invalid upload ticket"));
    return { ok: false, code: mapped.code === "states.genericRetry" ? "showroomProducts.images.errorUpload" : mapped.code };
  }
  return { ok: true, key: data };
}

/**
 * Confirm only AFTER the browser has uploaded: the database never reads the byte
 * store, so the existence check lives here, through the caller's own Storage access.
 */
export async function confirmProductImageUploadAction(key: string): Promise<ImageConfirmResult> {
  if (!isProductImageKey(key)) return { ok: false, code: "showroomProducts.images.errorUpload" };
  const supabase = await getServerSupabase();
  const slash = key.lastIndexOf("/");
  const { data: listed, error: listError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 5 });
  if (listError || !(listed ?? []).some((o) => o.name === key.slice(slash + 1))) {
    return { ok: false, code: "showroomProducts.images.errorUpload" };
  }
  const { data, error } = await supabase.rpc("product_image_confirm_upload", { p_object_key: key });
  if (error || typeof data !== "string" || !UUID.test(data)) {
    return { ok: false, code: error ? mapOwnProductError(error).code : "showroomProducts.images.errorUpload" };
  }
  revalidateProduct(key.split("/")[1]);
  return { ok: true, id: data };
}

export async function removeProductImageAction(imageId: string): Promise<ImageResult> {
  if (!UUID.test(imageId)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("product_image_remove", { p_image_id: imageId });
  if (error) return { ok: false, code: mapOwnProductError(error).code };
  if (typeof key === "string" && isProductImageKey(key)) {
    // Best-effort byte cleanup after the metadata change committed; an orphan is harmless and unreachable.
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([key]);
    revalidateProduct(key.split("/")[1]);
  }
  return { ok: true };
}

export async function reorderProductImagesAction(productId: string, imageIds: string[]): Promise<ImageResult> {
  if (!UUID.test(productId) || !Array.isArray(imageIds) || imageIds.some((id) => !UUID.test(id))) {
    return { ok: false, code: "states.genericRetry" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("product_image_reorder", { p_product_id: productId, p_image_ids: imageIds });
  if (error) return { ok: false, code: mapOwnProductError(error).code };
  revalidateProduct(productId);
  return { ok: true };
}
