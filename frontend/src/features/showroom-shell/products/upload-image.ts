"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/storage/product-images";
import { confirmProductImageUploadAction, requestProductImageUploadAction } from "@/server/actions/own-products";

/**
 * The one upload path for a product photo, shared by the image manager and the
 * create screen: ticket (pending metadata row, server-minted key) -> bytes straight
 * to the private bucket under that key -> confirm. Throws an i18n key on failure;
 * a failed upload leaves only an invisible pending row that expires on its own.
 */
export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const ticket = await requestProductImageUploadAction(productId, file.type);
  if (!ticket.ok) throw new Error(ticket.code);
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(ticket.key, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("showroomProducts.images.errorUpload");
  const confirmed = await confirmProductImageUploadAction(ticket.key);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.id;
}
