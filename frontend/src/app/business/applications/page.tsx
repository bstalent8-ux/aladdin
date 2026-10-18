import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadOrganizationApplications } from "@/server/queries/organization-applications";
import { ApplicationCenter } from "@/features/organization/application-center";
import { CoOwnerSection } from "@/features/organization/co-owner-section";
import { loadCoOwnerState } from "@/server/queries/organization-governance";

export const dynamic = "force-dynamic";

/**
 * ORGANIZATION APPLICATIONS - where an owner tracks every organization they have applied for.
 *
 * An application is never a workspace: this page is the only place a pending organization is
 * shown, apart from the approved ones it lists separately. Reached after submitting a business,
 * from the workspace menu, and from the "no workspace yet" state.
 */
export default async function OrganizationApplicationsPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const [{ rows, slot }, coOwners] = await Promise.all([loadOrganizationApplications(), loadCoOwnerState()]);
  return (
    <div className="flex flex-col gap-lg">
      <ApplicationCenter rows={rows} slot={slot} />
      {/* Membership is not ownership: only an Admin-verified co-owner is eligible to apply for their own organization. */}
      <CoOwnerSection rows={coOwners} />
    </div>
  );
}
