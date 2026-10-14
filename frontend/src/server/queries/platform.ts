import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type PlatformRole = "support" | "moderator" | "administrator";

/**
 * The caller's platform (staff) role, or null for an ordinary user.
 *
 * Derived from the Admin RBAC source of truth — `admin_my_access()`, i.e. the
 * caller's active `admin_role_assignments` — mapped onto the console's three
 * chrome tiers by RANK, exactly as the database's own `app.is_platform()` gate
 * does (administrator >= 80, moderator >= 60, support >= 1). Reading the legacy
 * `platform_role_grants` table here (as this used to) left an account provisioned
 * through the documented path — `admin_prepare_platform_account` then the one-time
 * `admin_bootstrap_super_admin` — locked out of /admin, because that path writes
 * an RBAC assignment only (a Super Admin has no legacy grant tier to mirror into).
 * Platform authority NEVER comes from `primary_account_type`. RLS and the RPCs
 * remain the real boundary on every admin query; this only decides what chrome
 * to render.
 */
export async function loadPlatformRole(
  supabase: SupabaseClient<Database>,
): Promise<PlatformRole | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("admin_my_access");
  if (error || !data) return null;
  const access = data as { is_staff?: boolean; rank?: number };
  if (!access.is_staff) return null;
  const rank = Number(access.rank ?? 0);
  if (rank >= 80) return "administrator";
  if (rank >= 60) return "moderator";
  if (rank >= 1) return "support";
  return null;
}

/** True when the caller may open the Admin surface (any staff role). */
export function isPlatformStaff(role: PlatformRole | null): boolean {
  return role !== null;
}

/**
 * True when the caller may take verification review actions. The trusted
 * `review_*` RPCs gate on `is_platform('support')`, i.e. ANY staff role, so the
 * UI mirrors that exactly — the RPC is still the enforcing boundary.
 */
export function canReview(role: PlatformRole | null): boolean {
  return role !== null;
}
