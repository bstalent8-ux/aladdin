import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import {
  toApplicationSlot,
  toApplicationStatus,
  type ApplicationRow,
  type ApplicationSlot,
} from "@/lib/workspace/applications";

/**
 * The caller's organization applications and whether another may be started.
 *
 * Both come from trusted `auth.uid()`-derived RPCs (`my_organization_applications`,
 * `my_organization_application_slot`). This is presentation data: the draft / submit / abandon
 * RPCs re-check every rule, so nothing here grants authority. An application is never a workspace.
 */
export async function loadOrganizationApplications(): Promise<{
  rows: ApplicationRow[];
  slot: ApplicationSlot;
}> {
  const supabase = await getServerSupabase();
  const [list, slot] = await Promise.all([
    supabase.rpc("my_organization_applications"),
    supabase.rpc("my_organization_application_slot"),
  ]);
  if (list.error) throw list.error;

  const rows: ApplicationRow[] = (list.data ?? []).map((r) => ({
    organizationId: r.organization_id,
    name: r.name,
    orgType: r.org_type ?? null,
    status: toApplicationStatus(r.application_status),
    reason: r.reason ?? null,
    submittedAt: r.submitted_at ?? null,
    decidedAt: r.decided_at ?? null,
    canSubmit: r.can_submit === true,
    canAbandon: r.can_abandon === true,
  }));
  return { rows, slot: toApplicationSlot(slot.error ? null : slot.data) };
}
