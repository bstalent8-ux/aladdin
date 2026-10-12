/** Shapes shared by the independent-publishing queries and screens (no server-only code). */
export type RequestStatus = "pending_review" | "needs_changes" | "rejected";
export type PublisherStatus = "active" | "suspended" | "revoked";

export type IndependentPublisherView = {
  /** The persona this person could publish as; null when they are neither a Contractor nor an Engineer. */
  eligibleKind: "contractor" | "engineer" | null;
  publisherId: string | null;
  status: PublisherStatus | null;
  displayName: string | null;
  requestStatus: RequestStatus | null;
  reason: string | null;
  canRequest: boolean;
};

export type IndependentProductRow = {
  id: string;
  name: string;
  code: string | null;
  status: "draft" | "published";
  version: number;
  unit: string;
  categoryCode: string | null;
  archived: boolean;
  audiences: string[];
};

export type CategoryOption = { code: string; labelEn: string; labelAr: string };

export function asRequestStatus(v: string | null | undefined): RequestStatus | null {
  return v === "pending_review" || v === "needs_changes" || v === "rejected" ? v : null;
}

export function asPublisherStatus(v: string | null | undefined): PublisherStatus | null {
  return v === "active" || v === "suspended" || v === "revoked" ? v : null;
}

/** What the screen shows, derived once so the UI and its tests agree. */
export type PublishingState =
  | "not_eligible"
  | "can_request"
  | "pending_review"
  | "needs_changes"
  | "rejected"
  | "active"
  | "suspended"
  | "revoked";

export function publishingState(v: IndependentPublisherView): PublishingState {
  if (!v.eligibleKind && !v.publisherId) return "not_eligible";
  if (v.status === "active") return "active";
  if (v.status === "suspended") return "suspended";
  if (v.requestStatus) return v.requestStatus;
  if (v.status === "revoked") return "revoked";
  return v.canRequest ? "can_request" : "not_eligible";
}
