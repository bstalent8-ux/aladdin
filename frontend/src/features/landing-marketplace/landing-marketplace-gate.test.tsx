import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingMarketplaceGate } from "./landing-marketplace-gate";

const state = vi.hoisted(() => ({ flag: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_MARKETPLACE_PREVIEW: state.flag }),
}));

const renderGate = () =>
  render(
    <I18nProvider locale="ar" dir="rtl">
      <LandingMarketplaceGate />
    </I18nProvider>,
  );

describe("LandingMarketplaceGate (release flag)", () => {
  beforeEach(() => { state.flag = undefined; });

  it.each([undefined, "false", "TRUE", "1", ""])("renders nothing when the flag is %j", (flag) => {
    state.flag = flag;
    const { container } = renderGate();
    expect(container.querySelector("#marketplace")).toBeNull();
  });

  it("renders the section only for the exact value \"true\"", () => {
    state.flag = "true";
    const { container } = renderGate();
    expect(container.querySelector("#marketplace")).not.toBeNull();
  });
});
