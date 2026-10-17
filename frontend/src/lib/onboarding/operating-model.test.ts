import { describe, expect, it } from "vitest";
import { PUBLIC_ACCOUNTS } from "@/lib/taxonomy/accounts";
import { APPLICATION_ORG_TYPES, BUSINESS_ORG_TYPES } from "./account-types";
import { applicationTypesFor, hasOperatingModels, organizationTypeFor } from "./operating-model";

describe("Contractor and Engineer operating models", () => {
  it("only Contractor and Engineer have an operating-model choice", () => {
    expect(hasOperatingModels("contractor")).toBe(true);
    expect(hasOperatingModels("engineer")).toBe(true);
    for (const p of ["installer_technician", "sales", "end_consumer", "showroom_dealer", null, undefined]) {
      expect(hasOperatingModels(p), String(p)).toBe(false);
    }
  });

  it("the organization models map to the internal organization types behind each account", () => {
    expect(organizationTypeFor("contractor")).toBe("contractor_company");
    expect(organizationTypeFor("engineer")).toBe("design_office");
  });

  it("operating models are NOT accounts: the nine public accounts are unchanged", () => {
    expect(PUBLIC_ACCOUNTS).toHaveLength(9);
    const ids = PUBLIC_ACCOUNTS.map((a) => a.id as string);
    for (const notAnAccount of ["contractor_company", "design_office", "independent_contractor", "engineering_office"]) {
      expect(ids).not.toContain(notAnAccount);
    }
  });

  it("a Contractor may apply only for a contractor organization; others keep the approved set", () => {
    expect(applicationTypesFor("contractor", BUSINESS_ORG_TYPES)).toEqual(["contractor_company"]);
    expect(applicationTypesFor("engineer", BUSINESS_ORG_TYPES)).toEqual(BUSINESS_ORG_TYPES);
    expect(applicationTypesFor(null, BUSINESS_ORG_TYPES)).toEqual(BUSINESS_ORG_TYPES);
  });

  it("contractor_company is an APPLICATION type but never a registerable business type", () => {
    expect(APPLICATION_ORG_TYPES as readonly string[]).toContain("contractor_company");
    expect(BUSINESS_ORG_TYPES as readonly string[]).not.toContain("contractor_company");
  });
});
