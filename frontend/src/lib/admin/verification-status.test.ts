import { describe, it, expect } from "vitest";
import { displayUserStatus } from "./verification-status";

describe("displayUserStatus", () => {
  it("shows an Admin-approved account as Verified even though users.status stays pending_verification", () => {
    expect(displayUserStatus({ status: "pending_verification", verificationState: "verified" })).toBe("verified");
  });
  it("leaves every other combination untouched", () => {
    expect(displayUserStatus({ status: "pending_verification", verificationState: "pending" })).toBe("pending_verification");
    expect(displayUserStatus({ status: "pending_verification", verificationState: "unverified" })).toBe("pending_verification");
    expect(displayUserStatus({ status: "suspended", verificationState: "verified" })).toBe("suspended");
    expect(displayUserStatus({ status: "active", verificationState: "verified" })).toBe("active");
  });
});
