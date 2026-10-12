import { isBusinessOrgType, type BusinessOrgType } from "@/lib/onboarding/account-types";

/**
 * MANDATORY FIRST BUSINESS - the pure rule (no I/O, so it is unit-testable and every caller asks the same question).
 *
 * Someone who registered to CREATE A BUSINESS ("Showroom", "Supplier", "Manufacturer", "Importer") must create that first
 * business before they get any other part of the product. The selected registration type is the registration INTENT, held
 * on `onboarding_progress` (`selected_track = 'business'` + `selected_org_type`). It is NOT a persona: choosing Showroom
 * never writes `users.primary_account_type`. The business onboarding creates `organizations.org_type`, and the creator
 * becomes its owner through the existing membership authority (`app.organization_create_owned`).
 *
 * The first business is still outstanding while ALL of these hold, and the rule needs nothing beyond data the database
 * already keeps:
 *
 *   - the registration intent is a business with an APPROVED org type (a legacy `wholesaler` intent is not offered);
 *   - the caller has no personal workspace (no personal persona). This is the same test the database uses to decide that
 *     a first-business registrant may create one (`app.can_create_or_complete_business`, path B, `not has_personal_persona`),
 *     so the gate can never send someone to a flow the database would refuse (no redirect trap). A person who also holds a
 *     persona (an Engineer, an Installer, a Salesperson) keeps today's behaviour: a business is an optional addition;
 *   - the caller belongs to no organization (an invited employee, or anyone who already created a business, has a
 *     membership and is therefore never gated);
 *   - the caller has never completed a business draft (so someone who created a business and later lost the membership is
 *     not forced to create another);
 *   - the caller is not platform staff.
 *
 * Because it is derived from the database on every request, it survives closing the browser, signing out and signing in,
 * and a direct visit to /home: there is nothing client-side to lose or bypass.
 */
export const MANDATORY_BUSINESS_SETUP_PATH = "/onboarding/business";

export type MandatoryBusinessSetupFacts = {
  /** `onboarding_progress.selected_track`. */
  track: string | null | undefined;
  /** `onboarding_progress.selected_org_type` - the business type chosen at registration. */
  selectedOrgType: string | null | undefined;
  /** The caller has a Personal workspace (`my_workspaces()` emits it on `app.has_personal_persona`). */
  hasPersonalWorkspace: boolean;
  /** Active organization memberships (owner, manager, invited employee, ...). */
  businessMembershipCount: number;
  /** At least one of the caller's business drafts has been completed (a business was created). */
  hasCompletedBusinessDraft: boolean;
  isPlatformStaff: boolean;
};

export type MandatoryBusinessSetup =
  | { required: true; orgType: BusinessOrgType }
  | { required: false; orgType: null };

export function decideMandatoryBusinessSetup(facts: MandatoryBusinessSetupFacts): MandatoryBusinessSetup {
  const orgType = facts.selectedOrgType;
  const required =
    facts.track === "business" &&
    isBusinessOrgType(orgType) &&
    !facts.hasPersonalWorkspace &&
    facts.businessMembershipCount === 0 &&
    !facts.hasCompletedBusinessDraft &&
    !facts.isPlatformStaff;
  return required && isBusinessOrgType(orgType) ? { required: true, orgType } : { required: false, orgType: null };
}
