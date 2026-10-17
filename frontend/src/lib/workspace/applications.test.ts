import { describe, expect, it } from "vitest";
import {
  APPLICATION_SLOTS,
  blockedReasonKey,
  slotAllowsNewApplication,
  slotErrorCode,
  splitApplications,
  toApplicationSlot,
  toApplicationStatus,
  type ApplicationRow,
} from "./applications";

const row = (status: ApplicationRow["status"], id: string = status): ApplicationRow => ({
  organizationId: id,
  name: id,
  orgType: "showroom_dealer",
  status,
  reason: null,
  submittedAt: null,
  decidedAt: null,
  canSubmit: false,
  canAbandon: false,
});

describe("application slot", () => {
  it("only the two *_available slots allow a new application", () => {
    for (const slot of APPLICATION_SLOTS) {
      expect(slotAllowsNewApplication(slot), slot).toBe(slot === "first_available" || slot === "additional_available");
    }
  });

  it("every blocked slot has an explanation; open slots have none", () => {
    for (const slot of APPLICATION_SLOTS) {
      expect(blockedReasonKey(slot) === null, slot).toBe(slotAllowsNewApplication(slot));
    }
    expect(blockedReasonKey("additional_pending")).toBe("orgApplications.blocked.additionalPending");
    expect(blockedReasonKey("first_rejected")).toBe("orgApplications.blocked.firstRejected");
  });

  it("an unknown value from the server is treated as NOT entitled (fail closed)", () => {
    expect(toApplicationSlot("something_new")).toBe("not_entitled");
    expect(toApplicationSlot(null)).toBe("not_entitled");
    expect(slotAllowsNewApplication(toApplicationSlot(undefined))).toBe(false);
  });
});

describe("application status", () => {
  it("normalises an unknown status to draft rather than approved", () => {
    expect(toApplicationStatus("approved")).toBe("approved");
    expect(toApplicationStatus("garbage")).toBe("draft");
    expect(toApplicationStatus(null)).toBe("draft");
  });

  it("separates approved organizations, open applications and history", () => {
    const { approved, open, history } = splitApplications([
      row("approved", "a"),
      row("pending_review", "b"),
      row("needs_changes", "c"),
      row("draft", "d"),
      row("rejected", "e"),
      row("abandoned", "f"),
      row("closed", "g"),
    ]);
    expect(approved.map((r) => r.organizationId)).toEqual(["a"]);
    expect(open.map((r) => r.organizationId)).toEqual(["b", "c", "d", "e"]);
    expect(history.map((r) => r.organizationId)).toEqual(["f", "g"]);
  });

  it("a pending application is never classed as an approved organization", () => {
    const { approved } = splitApplications([row("pending_review"), row("needs_changes"), row("draft"), row("rejected")]);
    expect(approved).toEqual([]);
  });
});

describe("slotErrorCode", () => {
  it("maps database hints to UI error keys and falls back to generic", () => {
    expect(slotErrorCode("additional_pending")).toBe("orgApplications.error.additional_pending");
    expect(slotErrorCode("first_rejected")).toBe("orgApplications.error.first_rejected");
    expect(slotErrorCode("application_closed")).toBe("orgApplications.error.applicationClosed");
    expect(slotErrorCode("awaiting_decision")).toBe("orgApplications.error.awaitingDecision");
    expect(slotErrorCode(null)).toBe("orgApplications.error.generic");
    expect(slotErrorCode("nonsense")).toBe("orgApplications.error.generic");
  });
});
