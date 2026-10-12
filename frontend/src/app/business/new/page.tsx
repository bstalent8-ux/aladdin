import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadBusinessCreationAccess } from "@/server/queries/business-creation-access";
import {
  BUSINESS_ORG_TYPES,
  applicationOrgTypeFrom,
  businessOrgTypeFromAccountType,
} from "@/lib/onboarding/account-types";
import { applicationTypesFor, hasOperatingModels, organizationTypeFor } from "@/lib/onboarding/operating-model";
import { BusinessFlow } from "@/features/onboarding/business-flow";
import { OperatingModelStep } from "@/features/onboarding/operating-model-step";

export const dynamic = "force-dynamic";

/**
 * ADD A BUSINESS - the authenticated entry point for someone who already has an
 * account. This is the whole point of "one person = one user id": an Engineer who
 * wants a showroom does not sign up again. There is no Sign Up, no new OTP, no
 * second auth identity, no second personal profile - just a new organization APPLICATION,
 * owned by the SAME user, reached from the workspace menu.
 *
 * Every organization is an application until an Admin approves it. The first one is the
 * only one that may be opened with nothing approved; after that, one additional application
 * may be open at a time (the database enforces both; this page only explains and routes).
 * A Contractor or Engineer first chooses how they operate (independently or as an
 * organization) - a choice of operating model, never a new account.
 */
export default async function AddBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const { allowed, data, persona, slotOpen } = await loadBusinessCreationAccess();
  if (!data) redirect("/auth/sign-in");
  // A taken slot is explained on the applications page rather than bounced to /home.
  if (!slotOpen) redirect("/business/applications");
  if (!allowed) redirect("/home");

  const { model } = await searchParams;
  const hasDraft = data.draftId !== null;

  // Contractor / Engineer: choose the operating model first (unless a draft already exists).
  if (hasOperatingModels(persona) && !hasDraft && model !== "organization") {
    return <OperatingModelStep persona={persona} />;
  }

  // A type chosen at registration carries through, so it is never asked twice. A Contractor
  // organization applicant is preset to the contractor organization type.
  const presetOrgType =
    businessOrgTypeFromAccountType(data.selectedAccountType) ??
    (persona === "contractor" ? organizationTypeFor("contractor") : null);
  const typeChoices = applicationTypesFor(persona, BUSINESS_ORG_TYPES)
    .map((k) => applicationOrgTypeFrom(k))
    .filter((k): k is NonNullable<typeof k> => k !== null);

  return (
    <BusinessFlow
      answers={data.business}
      presetOrgType={presetOrgType}
      draftId={data.draftId}
      typeChoices={typeChoices}
    />
  );
}
