import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  registration: "access_ready",
  data: null as unknown,
  mandatory: { required: false, orgType: null } as { required: boolean; orgType: string | null },
  flow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/server/queries/registration", () => ({
  getRegistrationState: async () => state.registration,
  hasAppAccess: (s: string) => s === "access_ready" || s === "active_personal",
}));
vi.mock("@/server/queries/onboarding", () => ({ getBusinessOnboardingData: async () => state.data }));
vi.mock("@/server/queries/business-setup", () => ({ loadMandatoryBusinessSetup: async () => state.mandatory }));
vi.mock("@/features/onboarding/business-flow", () => ({
  BusinessFlow: (props: unknown) => {
    state.flow(props);
    return null;
  },
}));

import BusinessOnboardingPage from "./page";

const business = (orgType: string | null, displayName: string | null = null) => ({
  legalName: null,
  displayName,
  orgType,
  description: null,
  governorate: null,
  city: null,
  primaryBranchName: null,
  organizationId: null,
  completedAt: null,
});

const data = (over: Record<string, unknown> = {}) => ({
  selectedTrack: "business",
  selectedAccountType: "showroom_dealer",
  draftId: null,
  business: business(null),
  ...over,
});

type FlowProps = {
  answers: { orgType: string | null; displayName: string | null };
  presetOrgType: string | null;
  draftId: string | null;
};
/** The page returns the wizard element; its props are what the wizard will be given. */
async function flowProps(): Promise<FlowProps> {
  const element = (await BusinessOnboardingPage()) as unknown as { props: FlowProps };
  state.flow(element.props);
  return element.props;
}

beforeEach(() => {
  state.flow.mockClear();
  state.registration = "access_ready";
  state.data = data();
  state.mandatory = { required: false, orgType: null };
});

describe("/onboarding/business", () => {
  it("carries the registered type into the wizard, so the type is never asked twice", async () => {
    state.mandatory = { required: true, orgType: "showroom_dealer" };
    const props = await flowProps();
    expect(props.presetOrgType).toBe("showroom_dealer");
    expect(props.answers.orgType).toBe("showroom_dealer");
  });

  it.each(["supplier", "manufacturer", "importer"])("a %s registration is created as that type", async (orgType) => {
    state.data = data({ selectedAccountType: orgType });
    state.mandatory = { required: true, orgType };
    const props = await flowProps();
    expect(props.presetOrgType).toBe(orgType);
    expect(props.answers.orgType).toBe(orgType);
  });

  it("while the first business is outstanding, the REGISTERED type wins over a different type left in an old draft", async () => {
    state.data = data({ business: business("supplier"), draftId: "draft-9" });
    state.mandatory = { required: true, orgType: "importer" };
    const props = await flowProps();
    expect(props.answers.orgType).toBe("importer");
    expect(props.presetOrgType).toBe("importer");
  });

  it("resumes the open draft after an interruption (same draft id, same saved answers)", async () => {
    state.data = data({ draftId: "draft-9", business: business("showroom_dealer", "Nile Showroom") });
    state.mandatory = { required: true, orgType: "showroom_dealer" };
    const props = await flowProps();
    expect(props.draftId).toBe("draft-9");
    expect(props.answers.displayName).toBe("Nile Showroom");
  });

  it("an owner adding another business keeps the old behaviour (the registration type decides, no lock)", async () => {
    state.data = data({ selectedAccountType: "supplier" });
    state.mandatory = { required: false, orgType: null };
    const props = await flowProps();
    expect(props.presetOrgType).toBe("supplier");
  });

  it("keeps its existing guards: signed out -> sign in; not yet access_ready -> /onboarding; no business intent -> /onboarding", async () => {
    state.registration = "unverified";
    await expect(BusinessOnboardingPage()).rejects.toThrow("REDIRECT:/auth/sign-in");
    state.registration = "username_pending";
    await expect(BusinessOnboardingPage()).rejects.toThrow("REDIRECT:/onboarding");
    state.registration = "access_ready";
    state.data = data({ selectedTrack: "professional" });
    await expect(BusinessOnboardingPage()).rejects.toThrow("REDIRECT:/onboarding");
    expect(state.flow).not.toHaveBeenCalled();
  });
});
