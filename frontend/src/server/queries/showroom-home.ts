import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CatalogRow } from "@/server/queries/commerce";
import { parseShowroomHomeMetrics, type ShowroomHomeMetrics } from "@/features/showroom-shell/home/metrics";

type DB = SupabaseClient<Database>;

/**
 * Read models for the showroom suite Home. Every read runs through the caller's
 * own client: RLS, the org guard inside the RPC and the explicit organization
 * filters below all apply, and nothing here uses a service-role client.
 */

/**
 * Directional KPI aggregates for one organization over one period — a single
 * round trip to `showroom_home_metrics` (20261007090002). `from`/`to` are the
 * inclusive `yyyy-mm-dd` window the Home resolved, `timezone` the organization's
 * own calendar, so every period-dependent card shares one range.
 */
export async function loadShowroomHomeMetrics(
  supabase: DB,
  orgId: string,
  range: { from: string; to: string },
  timezone: string,
): Promise<ShowroomHomeMetrics> {
  const { data, error } = await supabase.rpc("showroom_home_metrics", {
    p_org_id: orgId,
    p_from: range.from,
    p_to: range.to,
    p_timezone: timezone,
  });
  if (error) throw error;
  return parseShowroomHomeMetrics(data);
}

export type ShowroomKpiLayout = {
  /** The saved order as stored, or null when neither a personal nor a team row exists. */
  saved: string[] | null;
  hasPersonal: boolean;
  hasTeamDefault: boolean;
};

/**
 * The effective showroom-suite KPI layout: the caller's personal row, else the
 * organization's team default, else null (the catalog's system default applies).
 * Reads ONLY the `showroom_suite` surface — production Home's layouts are a
 * different surface and never mix with these.
 */
export async function loadShowroomKpiLayout(
  supabase: DB,
  orgId: string,
  membershipId: string,
): Promise<ShowroomKpiLayout> {
  const [personal, team] = await Promise.all([
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .eq("membership_id", membershipId)
      .eq("surface", "showroom_suite")
      .maybeSingle(),
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .is("membership_id", null)
      .eq("surface", "showroom_suite")
      .maybeSingle(),
  ]);
  if (personal.error) throw personal.error;
  if (team.error) throw team.error;
  return {
    saved: personal.data?.card_order ?? team.data?.card_order ?? null,
    hasPersonal: personal.data !== null,
    hasTeamDefault: team.data !== null,
  };
}

export type RecommendedProduct = Pick<
  CatalogRow,
  "id" | "name" | "brand" | "supplier_name" | "supplier_verified" | "unit" | "category"
> & { id: string; name: string };

export const RECOMMENDED_PRODUCT_LIMIT = 4;

/**
 * "منتجات مقترحة لك" — a small, DETERMINISTIC sample, not a recommendation
 * engine: the most recently published products from OTHER organizations (a
 * showroom is shown what it could buy, never its own listings), newest first
 * with the product id as the tie-break so equal timestamps never reorder. The
 * published-products view is already RLS-scoped. The full browsable catalog is
 * a later phase; this is only enough real data for the Home section.
 */
export async function loadRecommendedProducts(
  supabase: DB,
  orgId: string,
  limit = RECOMMENDED_PRODUCT_LIMIT,
): Promise<RecommendedProduct[]> {
  const { data, error } = await supabase
    .rpc("catalog_products", { p_org_id: orgId })
    // Every column named in order() must also be selected: PostgREST orders a function result by
    // the PROJECTED columns, so ordering by an unselected one fails the whole query
    // ("column record.published_at does not exist") and takes the Home body down with it.
    .select("id, name, brand, supplier_name, supplier_verified, unit, category, published_at")
    .neq("organization_id", orgId)
    .order("published_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<Pick<CatalogRow, "id" | "name" | "brand" | "supplier_name" | "supplier_verified" | "unit" | "category">>).filter(
    (row): row is RecommendedProduct => !!row.id && !!row.name,
  );
}
