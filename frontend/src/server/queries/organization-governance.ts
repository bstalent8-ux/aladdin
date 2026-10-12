import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import type { IdentityChangeView } from "@/features/organization/identity-change-panel";
import type { BranchGovernanceRow } from "@/features/organization/branch-governance";
import type { CoOwnerRow } from "@/features/organization/co-owner-section";

/**
 * Presentation data for the identity / branch / co-owner governance surfaces. Every read is a
 * trusted `auth.uid()`-derived RPC that already limits itself to the caller's own organization and
 * capability; nothing here grants authority, and the writers re-check everything.
 */
type RequestStatus = "pending_review" | "needs_changes" | "rejected";

function asRequestStatus(v: string | null | undefined): RequestStatus | null {
  return v === "pending_review" || v === "needs_changes" || v === "rejected" ? v : null;
}

export async function loadIdentityState(orgId: string): Promise<IdentityChangeView | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("organization_identity_state", { p_org_id: orgId });
  if (error || !data || data.length === 0) return null;
  const r = data[0]!;
  const proposed =
    r.proposed && typeof r.proposed === "object" && !Array.isArray(r.proposed)
      ? (r.proposed as IdentityChangeView["proposed"])
      : null;
  return {
    locked: r.locked,
    name: r.name,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    requestStatus: asRequestStatus(r.request_status),
    proposed,
    reason: r.reason,
  };
}

export async function loadManagedBranches(orgId: string): Promise<BranchGovernanceRow[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_branches", { p_org_id: orgId });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    nameAr: b.name_ar,
    nameEn: b.name_en,
    addressAr: b.address_ar,
    addressEn: b.address_en,
    timezone: b.timezone,
    isActive: b.is_active,
    locationVerified: b.location_verified,
    reviewStatus: b.review_status === "none" ? null : asRequestStatus(b.review_status),
    reviewReason: b.review_reason,
    hasUnreviewedChanges: b.has_unreviewed_changes,
  }));
}

export async function loadCoOwnerState(): Promise<CoOwnerRow[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_co_owner_state");
  if (error) return [];
  return (data ?? []).map((r) => ({
    organizationId: r.organization_id,
    name: r.name,
    relationship:
      r.relationship === "primary_owner" || r.relationship === "verified_co_owner" ? r.relationship : "member",
    requestStatus: asRequestStatus(r.request_status),
    reason: r.reason,
    canRequest: r.can_request,
  }));
}
