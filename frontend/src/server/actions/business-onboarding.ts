"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadBusinessCreationAccess } from "@/server/queries/business-creation-access";
import { APPLICATION_ORG_TYPES } from "@/lib/onboarding/account-types";
import { slotErrorCode } from "@/lib/workspace/applications";
import { isWithinDescriptionLimit } from "@/lib/text/description-limit";
import type { Database } from "@/types/database.types";

/**
 * Business creation writers. Thin, shape-only validators over the trusted
 * security-definer RPCs — the verified-caller gate, the required-field check, the
 * transactional organization + owner-membership + primary-branch creation, and the
 * idempotency guarantee all live in the database (`business_draft_save` /
 * `business_draft_submit` → app.organization_create_owned).
 *
 * The DRAFT ID is the thread that makes this safe. It is the resume handle and the
 * idempotency key: submitting the same draft twice returns the same organization,
 * while a new draft is a new business. The client therefore always round-trips the
 * id it was given rather than relying on the business name, which is neither
 * unique nor stable.
 *
 * The same writers serve both entry points — registration and "add a business"
 * from an existing account — because there is one persistence model behind both.
 */
export type BusinessActionState = { ok: boolean; code?: string; draftId?: string };

type OrgType = Database["public"]["Enums"]["organization_type"];

const businessSchema = z.object({
  draftId: z.string().uuid().nullish(),
  legalName: z.string().trim().max(120).nullish(),
  displayName: z.string().trim().max(120).nullish(),
  orgType: z.enum(APPLICATION_ORG_TYPES).nullish(),
  description: z.string().trim().refine(isWithinDescriptionLimit).nullish(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  primaryBranchName: z.string().trim().max(120).nullish(),
});
export type BusinessInput = z.input<typeof businessSchema>;

/** An over-limit description is the one validation failure a person can fix; everything else stays generic. */
function failedFieldCode(error: z.ZodError): string {
  return error.issues.some((i) => i.path[0] === "description") ? "onboarding.error.descriptionTooLong" : "onboarding.error.saveFailed";
}

function notEntitled(error: { code?: string }): boolean {
  return error.code === "42501";
}

/**
 * 42501 is either "not entitled to add a business" or the one-open-application rule; the
 * database says which through the error hint (`first_pending`, `first_rejected`,
 * `additional_pending`), so the person sees the real reason rather than a generic refusal.
 */
function failureCode(error: { code?: string; hint?: string | null; message?: string }): string {
  if (error.code === "22023" && /description/i.test(error.message ?? "")) return "onboarding.error.descriptionTooLong";
  if (!notEntitled(error)) return "onboarding.error.saveFailed";
  return error.hint ? slotErrorCode(error.hint) : "onboarding.error.businessNotAllowed";
}

/**
 * Persist the (accumulated) business draft. No organization is created and no
 * redirect happens. Returns the draft id so a client that started without one can
 * keep working against a stable key for the rest of the wizard.
 */
export async function saveBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: failedFieldCode(parsed.error) };
  const v = parsed.data;

  // The same entitlement the page applies — a direct post to this action must not
  // be a way around it. (No RLS change: the database rules are untouched.)
  if (!(await loadBusinessCreationAccess()).allowed) return { ok: false, code: "onboarding.error.businessNotAllowed" };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("business_draft_save", {
    p_draft_id: v.draftId ?? undefined,
    p_legal_name: v.legalName ?? undefined,
    p_display_name: v.displayName ?? undefined,
    p_org_type: (v.orgType as OrgType) ?? undefined,
    p_description: v.description ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_primary_branch_name: v.primaryBranchName ?? undefined,
  });
  // The database is the final authority on who may open a business (42501 = not
  // entitled, `20260928090001_business_creation_entitlement.sql`); say so plainly.
  if (error) return { ok: false, code: failureCode(error) };
  return { ok: true, draftId: data ?? undefined };
}

/**
 * Persist the final draft, create the PROVISIONAL organization and submit it for Admin review.
 *
 * The creator becomes Owner automatically, but the organization is an APPLICATION until an Admin
 * approves it: it has no audience and no commercial authority, so it is NOT made the active
 * workspace and the owner is sent to the application status page instead of the B2B cockpit.
 *
 * Retry safety: the RPCs short-circuit on the draft's recorded organization and on an
 * already-open application, so a network retry or a double click yields ONE organization and ONE
 * application.
 */
export async function submitBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const saved = await saveBusiness(input);
  if (!saved.ok) return saved;

  const supabase = await getServerSupabase();
  const { data: orgId, error } = await supabase.rpc("business_draft_submit", {
    p_draft_id: input.draftId ?? saved.draftId ?? undefined,
  });
  if (error) return { ok: false, code: failureCode(error), draftId: saved.draftId };

  if (orgId) {
    const submitted = await supabase.rpc("organization_application_submit", { p_org_id: orgId });
    // The organization exists; a failed submission leaves it a draft the owner can submit from the
    // status page, so this is reported without losing anything.
    if (submitted.error) {
      revalidatePath("/", "layout");
      redirect("/business/applications");
    }
  }
  revalidatePath("/", "layout");
  redirect("/business/applications");
}
