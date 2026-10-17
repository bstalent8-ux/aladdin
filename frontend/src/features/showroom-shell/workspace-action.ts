"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadWorkspaces } from "@/server/queries/workspace";
import { ORG_COOKIE, BRANCH_COOKIE } from "@/lib/workspace/model";
import { eligibleWorkspaces } from "./workspace-model";

// Mirrors selectWorkspace's membership boundary and cookie contract, but redirects
// only inside this suite. Production context actions are deliberately unchanged.
export async function selectShowroomWorkspace(value: string): Promise<{ error: boolean }> {
  const id = z.string().uuid().safeParse(value);
  if (!id.success || !hasAppAccess(await getRegistrationState())) return { error: true };
  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!eligibleWorkspaces(entries).some((entry) => entry.organizationId === id.data)) return { error: true };
  const store = await cookies();
  store.set(ORG_COOKIE, id.data, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  store.delete(BRANCH_COOKIE);
  revalidatePath("/showroom", "layout");
  redirect("/showroom/home");
}
