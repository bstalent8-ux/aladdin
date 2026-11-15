import { describe, it, expect } from "vitest";
import { canStartVerification } from "./verification-status";

describe("canStartVerification for active accounts", () => {
  it("offers Admin verification for an active, unverified professional (reachable via All / Unverified)", () => {
    expect(canStartVerification({ accountType: "engineer", status: "active", verificationState: "unverified" })).toBe(true);
  });
  it("does not offer it for an active consumer, a verified account or a suspended one", () => {
    expect(canStartVerification({ accountType: "end_consumer", status: "active", verificationState: "unverified" })).toBe(false);
    expect(canStartVerification({ accountType: "engineer", status: "active", verificationState: "verified" })).toBe(false);
    expect(canStartVerification({ accountType: "engineer", status: "suspended", verificationState: "unverified" })).toBe(false);
  });
});

import { hasUnappliedProfessionalApproval } from "./verification-status";

describe("hasUnappliedProfessionalApproval", () => {
  const v = (status: string, requestedAccountType: string | null) => ({ status, verificationType: "professional", requestedAccountType });
  it("is true when the request is approved but the account has not taken the requested type (apply did not complete)", () => {
    expect(hasUnappliedProfessionalApproval({ accountType: null, verifications: [v("approved", "installer_technician")] })).toBe(true);
  });
  it("is false once applied, for open or rejected requests, and without a requested type", () => {
    expect(hasUnappliedProfessionalApproval({ accountType: "installer_technician", verifications: [v("approved", "installer_technician")] })).toBe(false);
    expect(hasUnappliedProfessionalApproval({ accountType: null, verifications: [v("submitted", "installer_technician"), v("rejected", "installer_technician")] })).toBe(false);
    expect(hasUnappliedProfessionalApproval({ accountType: null, verifications: [v("approved", null)] })).toBe(false);
  });
});
