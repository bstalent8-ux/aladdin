import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadWorkspaceContext } from "@/server/queries/context";
import { isShowroomBusinessType } from "./workspace-model";

// Both layout and leaf pages call this; cached only within the server request.
export const requireShowroomContext = cache(async () => {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in?next=%2Fshowroom%2Fhome");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);
  if (!workspace.active || !isShowroomBusinessType(workspace.active.orgType)) redirect("/b2b");
  return { supabase, workspace, org: workspace.active };
});

/** Commercial screens (browse, saved, product details) exist only for an APPROVED organization; a pending owner is sent home. */
export async function requireApprovedShowroomContext() {
  const ctx = await requireShowroomContext();
  if (ctx.org.isApproved !== true) redirect("/showroom/home");
  return ctx;
}
