import { describe, it, expect } from "vitest";
import {
  canStartVerification,
  findUnappliedOrganizationApproval,
  findUnappliedProfessionalApproval,
  hasUnappliedProfessionalApproval,
} from "./verification-status";

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

const v = (status: string, requestedAccountType: string | null, verificationType = "professional", id = "r1") => ({ id, status, verificationType, requestedAccountType });

describe("findUnappliedProfessionalApproval", () => {
  it("returns the EXACT approved request when the account has not taken the requested type", () => {
    const found = findUnappliedProfessionalApproval({ accountType: null, verifications: [v("rejected", "installer_technician", "professional", "old"), v("approved", "installer_technician", "professional", "target")] });
    expect(found?.id).toBe("target");
    expect(hasUnappliedProfessionalApproval({ accountType: null, verifications: [v("approved", "installer_technician")] })).toBe(true);
  });
  it("is null once applied, for open or rejected requests, and without a requested type", () => {
    expect(findUnappliedProfessionalApproval({ accountType: "installer_technician", verifications: [v("approved", "installer_technician")] })).toBeNull();
    expect(findUnappliedProfessionalApproval({ accountType: null, verifications: [v("submitted", "installer_technician"), v("rejected", "installer_technician")] })).toBeNull();
    expect(findUnappliedProfessionalApproval({ accountType: null, verifications: [v("approved", null)] })).toBeNull();
  });
});

describe("findUnappliedOrganizationApproval", () => {
  it("returns the approved organization request while the organization is not yet verified", () => {
    expect(findUnappliedOrganizationApproval({ isVerified: false, status: "pending_verification", verifications: [v("approved", null, "organization", "o1")] })?.id).toBe("o1");
  });
  it("is null once verified, for an active organization, or for other request types", () => {
    expect(findUnappliedOrganizationApproval({ isVerified: true, status: "active", verifications: [v("approved", null, "organization")] })).toBeNull();
    expect(findUnappliedOrganizationApproval({ isVerified: false, status: "active", verifications: [v("approved", null, "organization")] })).toBeNull();
    expect(findUnappliedOrganizationApproval({ isVerified: false, status: "pending_verification", verifications: [v("approved", null, "business")] })).toBeNull();
  });
});
