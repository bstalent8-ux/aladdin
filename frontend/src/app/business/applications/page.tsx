import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadOrganizationApplications } from "@/server/queries/organization-applications";
import { ApplicationCenter } from "@/features/organization/application-center";

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

  const { rows, slot } = await loadOrganizationApplications();
  return <ApplicationCenter rows={rows} slot={slot} />;
}
