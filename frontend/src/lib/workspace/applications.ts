/**
 * Organization applications — what the owner sees, and why another one may be blocked.
 *
 * An APPLICATION is never a workspace. Approved organizations are operational workspaces;
 * everything else is a record the owner can complete, submit, correct, abandon and track. The
 * database is the authority on every rule below (`app.application_slot`, the draft/submit/abandon
 * RPCs); this module only names the states and picks the explanation to show.
 */
export const APPLICATION_STATUSES = [
  "draft",
  "pending_review",
  "needs_changes",
  "rejected",
  "approved",
  "abandoned",
  "closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type ApplicationRow = {
  organizationId: string;
  name: string;
  orgType: string | null;
  status: ApplicationStatus;
  reason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  canSubmit: boolean;
  canAbandon: boolean;
};

export function toApplicationStatus(value: string | null | undefined): ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value ?? "") ? (value as ApplicationStatus) : "draft";
}

/** `public.my_organization_application_slot()` values. */
export const APPLICATION_SLOTS = [
  "first_available",
  "first_pending",
  "first_rejected",
  "additional_available",
  "additional_pending",
  "not_entitled",
] as const;
export type ApplicationSlot = (typeof APPLICATION_SLOTS)[number];

export function toApplicationSlot(value: string | null | undefined): ApplicationSlot {
  return (APPLICATION_SLOTS as readonly string[]).includes(value ?? "") ? (value as ApplicationSlot) : "not_entitled";
}

export function slotAllowsNewApplication(slot: ApplicationSlot): boolean {
  return slot === "first_available" || slot === "additional_available";
}

/** The i18n key (under `orgApplications.blocked.*`) explaining why a new application is unavailable. */
export function blockedReasonKey(slot: ApplicationSlot): string | null {
  switch (slot) {
    case "first_pending":
      return "orgApplications.blocked.firstPending";
    case "first_rejected":
      return "orgApplications.blocked.firstRejected";
    case "additional_pending":
      return "orgApplications.blocked.additionalPending";
    case "not_entitled":
      return "orgApplications.blocked.notEntitled";
    default:
      return null;
  }
}

/** Approved organizations and open/closed applications are shown as two separate groups. */
export function splitApplications(rows: readonly ApplicationRow[]): {
  approved: ApplicationRow[];
  open: ApplicationRow[];
  history: ApplicationRow[];
} {
  const approved: ApplicationRow[] = [];
  const open: ApplicationRow[] = [];
  const history: ApplicationRow[] = [];
  for (const r of rows) {
    if (r.status === "approved") approved.push(r);
    else if (r.status === "abandoned" || r.status === "closed") history.push(r);
    else open.push(r);
  }
  return { approved, open, history };
}

/** Database hint -> UI error code, shared by every action that can be refused by the slot rule. */
export function slotErrorCode(hint: string | null | undefined): string {
  switch (hint) {
    case "first_pending":
    case "first_rejected":
    case "additional_pending":
      return `orgApplications.error.${hint}`;
    case "application_closed":
      return "orgApplications.error.applicationClosed";
    case "awaiting_decision":
      return "orgApplications.error.awaitingDecision";
    default:
      return "orgApplications.error.generic";
  }
}
