import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadIsAdminStaff } from "@/server/queries/platform";
import { loadWorkspaces } from "@/server/queries/workspace";
import { landingFor } from "@/lib/workspace/model";
import { computeMandatoryBusinessSetup } from "@/server/queries/business-setup";
import { MANDATORY_BUSINESS_SETUP_PATH } from "@/lib/onboarding/mandatory-business-setup";

export type ActiveLanding = "/admin" | "/b2b" | "/home" | typeof MANDATORY_BUSINESS_SETUP_PATH;

/**
 * Where an ACTIVE ("active_personal") caller belongs. Landing is DERIVED from the
 * caller's real work contexts and their current selection — never from a role
 * switcher, and never from an account type (PRODUCT_DIRECTION_GUIDE):
 *
 *   1. Platform staff                              → /admin
 *   2. A business registration whose FIRST business
 *      has not been created yet                    → /onboarding/business (mandatory; resumable)
 *   3. Selected (or only) business workspace       → /b2b
 *   4. Personal workspace                          → /home
 *
 * Rule 2 is what stops someone who registered as a Showroom / Supplier / Manufacturer / Importer from being dropped on a
 * generic "you have no workspace" page after verifying their email: the registration choice decides the first experience,
 * and there is no generic Personal fallback for a business registration. It is derived from the database on every call
 * (see `computeMandatoryBusinessSetup`), so it also resumes after sign-out and sign-in.
 *
 * The two rules that matter for the account model:
 *   * a BUSINESS-ONLY identity — no personal persona, one or more active
 *     memberships — lands in /b2b and is never shown an empty Personal home;
 *   * an identity that has BOTH keeps whichever context it selected, so an
 *     Engineer who also owns a business is no longer trapped in /b2b.
 *
 * Verification state is not consulted anywhere here: it is a trust state, not an
 * access gate.
 */
export async function resolveActiveLanding(
  supabase: SupabaseClient<Database>,
): Promise<ActiveLanding> {
  if (await loadIsAdminStaff(supabase)) return "/admin";

  if ((await computeMandatoryBusinessSetup(supabase)).required) return MANDATORY_BUSINESS_SETUP_PATH;

  const { context } = await loadWorkspaces(supabase);
  return landingFor(context, false);
}

/** Convenience for route handlers: resolve the active caller's landing path. */
export async function activeLandingPath(): Promise<ActiveLanding> {
  const supabase = await getServerSupabase();
  return resolveActiveLanding(supabase);
}
