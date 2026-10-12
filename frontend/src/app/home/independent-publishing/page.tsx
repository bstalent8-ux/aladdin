import { notFound, redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import {
  loadCategoryOptions,
  loadIndependentProducts,
  loadMyIndependentPublisher,
} from "@/server/queries/independent-publisher";
import { IndependentPublishing } from "@/features/independent-publishing/independent-publishing";

export const dynamic = "force-dynamic";

/**
 * An independent Contractor / Engineer own publishing area (M4a). The acting identity here is the
 * independent publisher of the signed-in person - an explicit, per-request choice the database
 * re-verifies - never a union with any organization they belong to. Reachable only by direct route:
 * independent commerce has no public navigation while the platform gate is closed.
 */
export default async function IndependentPublishingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const view = await loadMyIndependentPublisher();
  if (!view || (!view.eligibleKind && !view.publisherId)) notFound();

  const active = view.status === "active" && view.publisherId !== null;
  const [products, categories] = await Promise.all([
    view.publisherId ? loadIndependentProducts(view.publisherId) : Promise.resolve([]),
    active ? loadCategoryOptions() : Promise.resolve([]),
  ]);
  return <IndependentPublishing view={view} products={products} categories={categories} />;
}
