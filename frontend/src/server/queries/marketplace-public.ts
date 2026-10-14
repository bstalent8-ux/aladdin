import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Public Marketplace reads (Migration 09). Each RPC is granted to anon and
 * returns ONLY published products of currently enabled sellers with an active
 * type/category; image ids appear only while the media flag is on and the image
 * is verified. These loaders add nothing to that gate — they shape the JSON.
 */

export type PublicCard = {
  slug: string;
  name_ar: string;
  name_en: string;
  brand: string | null;
  product_type_key: string;
  product_type_name_ar: string;
  product_type_name_en: string;
  category_key: string;
  category_name_ar: string;
  category_name_en: string;
  seller_name: string;
  from_price_egp: number | null;
  in_stock: boolean;
  variant_count: number;
  image_id: string | null;
};

export type PublicPage = { total: number; limit: number; offset: number; items: PublicCard[] };

export type FacetType = { key: string; name_ar: string; name_en: string; count: number };
export type FacetCategory = FacetType & { types: FacetType[] };

export type AttrValue =
  | { key: string; name_ar: string; name_en: string; swatch_hex: string | null }
  | number
  | boolean
  | string
  | null;

export type PublicAttribute = {
  key: string;
  name_ar: string;
  name_en: string;
  data_type: string;
  unit_kind: string | null;
  unit_ar: string | null;
  unit_en: string | null;
  value: AttrValue;
};

export type PublicVariant = {
  sku: string;
  selling_unit: string;
  price_egp: number;
  purchasable: boolean;
  attributes: PublicAttribute[];
};

export type PublicProduct = {
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  brand: string | null;
  product_type_key: string;
  product_type_name_ar: string;
  product_type_name_en: string;
  category_key: string;
  category_name_ar: string;
  category_name_en: string;
  seller_name: string;
  cover_image_id: string | null;
  attributes: PublicAttribute[];
  variants: PublicVariant[];
  images: { image_id: string; is_primary: boolean; alt_text_ar: string | null; alt_text_en: string | null; variant_sku: string | null }[];
};

export const PUBLIC_PAGE_SIZE = 24;
export const PUBLIC_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type PublicSort = (typeof PUBLIC_SORTS)[number];

export async function loadPublicCatalogPage(params: {
  category?: string | null;
  type?: string | null;
  query?: string | null;
  sort: PublicSort;
  page: number;
}): Promise<PublicPage | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_catalog_page", {
    p_category: params.category || undefined,
    p_type: params.type || undefined,
    p_query: params.query?.slice(0, 100) || undefined,
    p_sort: params.sort,
    p_limit: PUBLIC_PAGE_SIZE,
    p_offset: (Math.max(1, params.page) - 1) * PUBLIC_PAGE_SIZE,
  });
  if (error || !data) return null;
  return data as unknown as PublicPage;
}

export async function loadPublicFacets(): Promise<FacetCategory[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_facets");
  if (error || !data) return [];
  return ((data as unknown as { categories: FacetCategory[] }).categories ?? []).map((c) => ({
    ...c,
    count: Number(c.count),
    types: (c.types ?? []).map((t) => ({ ...t, count: Number(t.count) })),
  }));
}

export async function loadPublicProduct(slug: string): Promise<PublicProduct | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_product", { p_slug: slug });
  if (error || !data) return null;
  return data as unknown as PublicProduct;
}
