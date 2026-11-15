import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The outcome of `craftsman_profile_verification_submit()` — the database's decision, never the browser's.
 * `submitted` / `resubmitted` mean a request now waits in Admin > Verifications; `already_open` an earlier one still
 * waits; `approved` / `rejected` are left exactly as decided (never reset, never auto-resubmitted); `incomplete` means
 * the profile is below 100%. Anything else (including an error) is reported as `null`.
 */
export type CraftsmanVerificationOutcome = "submitted" | "resubmitted" | "already_open" | "approved" | "rejected" | "incomplete";

const OUTCOMES: readonly string[] = ["submitted", "resubmitted", "already_open", "approved", "rejected", "incomplete"];

/**
 * Ask the database to file the Craftsman's ONE professional verification request if (and only if) the authoritative
 * profile completion is 100%. Called after every write that can move the completion (saving the profile, adding a
 * portfolio project, confirming an avatar, saving the phone). It is best-effort: a failure here must never fail the
 * save that triggered it, so errors resolve to `null`. A caller that is not a Craftsman is refused by the RPC (42501)
 * and also yields `null`. The RPC is idempotent, so calling it on every relevant save never creates a second request.
 */
export async function submitCraftsmanVerificationIfComplete(): Promise<CraftsmanVerificationOutcome | null> {
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("craftsman_profile_verification_submit");
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
    const state = (data as { state?: unknown }).state;
    return typeof state === "string" && OUTCOMES.includes(state) ? (state as CraftsmanVerificationOutcome) : null;
  } catch {
    return null;
  }
}
