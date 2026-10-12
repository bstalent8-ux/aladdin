import { describe, expect, it } from "vitest";
import {
  MANDATORY_BUSINESS_SETUP_PATH,
  decideMandatoryBusinessSetup,
  type MandatoryBusinessSetupFacts,
} from "./mandatory-business-setup";

/** A brand-new business registrant: verified, business track, a type chosen, nothing created yet. */
const registrant = (over: Partial<MandatoryBusinessSetupFacts> = {}): MandatoryBusinessSetupFacts => ({
  track: "business",
  selectedOrgType: "showroom_dealer",
  hasPersonalWorkspace: false,
  businessMembershipCount: 0,
  hasCompletedBusinessDraft: false,
  isPlatformStaff: false,
  ...over,
});

describe("mandatory first business", () => {
  it("the setup path is the existing business onboarding route", () => {
    expect(MANDATORY_BUSINESS_SETUP_PATH).toBe("/onboarding/business");
  });

  it.each(["showroom_dealer", "supplier", "manufacturer", "importer"])("is required for a %s registration, and carries that exact type", (orgType) => {
    expect(decideMandatoryBusinessSetup(registrant({ selectedOrgType: orgType }))).toEqual({ required: true, orgType });
  });

  it("is not required once the first business exists (an active membership)", () => {
    expect(decideMandatoryBusinessSetup(registrant({ businessMembershipCount: 1 })).required).toBe(false);
    expect(decideMandatoryBusinessSetup(registrant({ businessMembershipCount: 3 })).required).toBe(false);
  });

  it("is not required of someone who created a business and later lost the membership", () => {
    expect(decideMandatoryBusinessSetup(registrant({ hasCompletedBusinessDraft: true })).required).toBe(false);
  });

  it("an invited organization employee (membership, no business track) is never gated", () => {
    expect(decideMandatoryBusinessSetup(registrant({ track: null, selectedOrgType: null, businessMembershipCount: 1 })).required).toBe(false);
  });

  it("keeps today's behaviour for anyone holding a personal persona (Engineer, Installer, Salesperson): a business is optional", () => {
    expect(decideMandatoryBusinessSetup(registrant({ hasPersonalWorkspace: true })).required).toBe(false);
  });

  it.each(["professional", "consumer", null, undefined])("a %s registration is not a business registration", (track) => {
    expect(decideMandatoryBusinessSetup(registrant({ track })).required).toBe(false);
  });

  it("requires an APPROVED business type: a legacy wholesaler intent, a persona key, or nothing is not enough", () => {
    for (const selectedOrgType of ["wholesaler", "installer_technician", "sales", "engineer", "", null, undefined]) {
      expect(decideMandatoryBusinessSetup(registrant({ selectedOrgType })).required, String(selectedOrgType)).toBe(false);
    }
  });

  it("platform staff are exempt", () => {
    expect(decideMandatoryBusinessSetup(registrant({ isPlatformStaff: true })).required).toBe(false);
  });

  it("never reports a type when not required", () => {
    expect(decideMandatoryBusinessSetup(registrant({ businessMembershipCount: 1 }))).toEqual({ required: false, orgType: null });
  });
});
