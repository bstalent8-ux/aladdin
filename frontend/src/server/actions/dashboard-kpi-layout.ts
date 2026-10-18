"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { DashboardKpiCardKey } from "@/lib/workspace/dashboard-kpi-catalog";
import type { ShowroomKpiKey } from "@/features/showroom-shell/home/kpi-catalog";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";

/** Which dashboard a layout belongs to. `home` is production /b2b Home; `showroom_suite` is the showroom suite Home. */
export type KpiSurface = "home" | "showroom_suite";
type KpiCardKey = DashboardKpiCardKey | ShowroomKpiKey;

function revalidateSurface(surface: KpiSurface) {
  revalidatePath(surface === "showroom_suite" ? `${SHOWROOM_ROOT}/home` : "/b2b");
}

/**
 * Thin Server Actions over the four `dashboard_kpi_layout_*` RPCs
 * (20260915090001) — no authorization decision made here, the RPCs decide
 * (an ordinary member calling the team-default actions is rejected there).
 * Plain `{ok}` returns rather than the `FormState`/`useActionState` shape
 * `organization-i18n.ts` uses: the customization dialog drives these from
 * its own interactive reorder/show-hide state, not a per-field form.
 */
export type KpiLayoutActionResult = { ok: true } | { ok: false; message: string };

export async function setPersonalKpiLayoutAction(
  orgId: string,
  cardOrder: KpiCardKey[],
  surface: KpiSurface = "home",
): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_set_personal", {
    p_org_id: orgId,
    p_card_order: cardOrder,
    p_surface: surface,
  });
  if (error) return { ok: false, message: error.message };
  revalidateSurface(surface);
  return { ok: true };
}

export async function resetPersonalKpiLayoutAction(orgId: string, surface: KpiSurface = "home"): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_reset_personal", { p_org_id: orgId, p_surface: surface });
  if (error) return { ok: false, message: error.message };
  revalidateSurface(surface);
  return { ok: true };
}

export async function setTeamDefaultKpiLayoutAction(
  orgId: string,
  cardOrder: KpiCardKey[],
  surface: KpiSurface = "home",
): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_set_team_default", {
    p_org_id: orgId,
    p_card_order: cardOrder,
    p_surface: surface,
  });
  if (error) return { ok: false, message: error.message };
  revalidateSurface(surface);
  return { ok: true };
}

export async function resetTeamDefaultKpiLayoutAction(orgId: string, surface: KpiSurface = "home"): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_reset_team_default", { p_org_id: orgId, p_surface: surface });
  if (error) return { ok: false, message: error.message };
  revalidateSurface(surface);
  return { ok: true };
}
