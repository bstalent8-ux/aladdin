"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapGovernanceError } from "@/server/actions/error-mapping";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Writers for a verified organization's identity changes, its branches and co-owner verification.
 *
 * No authorization decision is made here. Who may request a name change, who may add a branch,
 * which organizations are approved, what is publicly verified and who counts as a co-owner are all
 * decided by the trusted RPCs (`organization_identity_change_request`, `branch_create`,
 * `branch_verification_request`, `org_co_owner_request`, ...). These actions validate shape,
 * translate the outcome to a stable key and revalidate the page - a forged call can only be refused.
 *
 * Nothing here can reach the business TYPE: no parameter exists for it anywhere in the workflow.
 */
const uuid = z.string().uuid();

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidate() {
  revalidatePath("/b2b/settings");
  revalidatePath("/business/applications");
}

export async function requestIdentityChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid.safeParse(field(fd, "orgId"));
  if (!orgId.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_identity_change_request", {
    p_org_id: orgId.data,
    p_name: field(fd, "name"),
    p_name_ar: field(fd, "nameAr"),
    p_name_en: field(fd, "nameEn"),
  });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.identity.requested" };
}

export async function withdrawIdentityChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid.safeParse(field(fd, "orgId"));
  if (!orgId.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_identity_change_withdraw", { p_org_id: orgId.data });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.identity.withdrawn" };
}

export async function createBranchAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid.safeParse(field(fd, "orgId"));
  if (!orgId.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("branch_create", {
    p_org_id: orgId.data,
    p_name: field(fd, "name"),
    p_name_ar: field(fd, "nameAr"),
    p_name_en: field(fd, "nameEn"),
    p_address_ar: field(fd, "addressAr"),
    p_address_en: field(fd, "addressEn"),
    p_timezone: field(fd, "timezone"),
  });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.branches.created" };
}

export async function requestBranchVerificationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const branchId = uuid.safeParse(field(fd, "branchId"));
  if (!branchId.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("branch_verification_request", { p_branch_id: branchId.data });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.branches.requested" };
}

export async function setBranchActiveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const branchId = uuid.safeParse(field(fd, "branchId"));
  if (!branchId.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("branch_set_active", {
    p_branch_id: branchId.data,
    p_active: field(fd, "active") === "true",
  });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.branches.updated" };
}

export async function requestCoOwnerVerificationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid.safeParse(field(fd, "orgId"));
  if (!orgId.success) return { ok: false, code: "states.genericRetry" };
  const note = field(fd, "note").trim().slice(0, 500);
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("org_co_owner_request", { p_org_id: orgId.data, p_note: note });
  if (error) return { ok: false, code: mapGovernanceError(error) };
  revalidate();
  return { ok: true, code: "governance.coOwner.requested" };
}
