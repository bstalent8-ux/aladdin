import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { KpiCustomizeDialog } from "./kpi-customize-dialog";
import { SHOWROOM_KPI_DEFAULT_ORDER } from "@/features/showroom-shell/home/kpi-catalog";
import { SYSTEM_DEFAULT_KPI_ORDER } from "@/lib/workspace/dashboard-kpi-catalog";

const actions = vi.hoisted(() => ({
  setPersonal: vi.fn(async () => ({ ok: true as const })),
  resetPersonal: vi.fn(async () => ({ ok: true as const })),
  setTeam: vi.fn(async () => ({ ok: true as const })),
  resetTeam: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/server/actions/dashboard-kpi-layout", () => ({
  setPersonalKpiLayoutAction: actions.setPersonal,
  resetPersonalKpiLayoutAction: actions.resetPersonal,
  setTeamDefaultKpiLayoutAction: actions.setTeam,
  resetTeamDefaultKpiLayoutAction: actions.resetTeam,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function renderDialog(props: Partial<React.ComponentProps<typeof KpiCustomizeDialog>> = {}) {
  render(
    <I18nProvider locale="en" dir="ltr">
      <KpiCustomizeDialog
        orgId="org-1"
        availableKeys={[...SHOWROOM_KPI_DEFAULT_ORDER]}
        initialOrder={[...SHOWROOM_KPI_DEFAULT_ORDER]}
        hasPersonal={false}
        hasTeamDefault={false}
        canManageTeamDefault
        surface="showroom_suite"
        {...props}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId("kpi-customize-trigger"));
}

beforeEach(() => vi.clearAllMocks());

describe("KpiCustomizeDialog on the showroom suite surface", () => {
  it("lists the ten suite cards with their direction spelled out", () => {
    renderDialog();
    expect(screen.getByText("Open purchase requests (purchasing)")).toBeTruthy();
    expect(screen.getByText("Customer RFQs received (sales)")).toBeTruthy();
    expect(screen.getByText("Total sales (sales)")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("allows a hidden card to be re-enabled up to ten, never past it", () => {
    renderDialog({ initialOrder: SHOWROOM_KPI_DEFAULT_ORDER.slice(0, 9) });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("saves the member's layout for the showroom_suite surface, in the displayed order", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalledTimes(1));
    expect(actions.setPersonal).toHaveBeenCalledWith("org-1", [...SHOWROOM_KPI_DEFAULT_ORDER], "showroom_suite");
  });

  it("persists a hide + reorder exactly as the member left it", async () => {
    renderDialog();
    const row = (label: string) => screen.getByText(label).closest("li")!;
    fireEvent.click(within(row("Saved products")).getByRole("button", { name: "Hide" }));
    fireEvent.click(within(row("Total sales (sales)")).getByRole("button", { name: "Move up" }));
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalled());
    const saved = (actions.setPersonal.mock.calls[0] as unknown as [string, string[], string])[1];
    expect(saved).not.toContain("saved_products");
    expect(saved.indexOf("total_sales")).toBe(SHOWROOM_KPI_DEFAULT_ORDER.indexOf("total_sales") - 1);
  });

  it("publishes the team default for the same surface, owners only", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("kpi-customize-save-team-default"));
    await waitFor(() => expect(actions.setTeam).toHaveBeenCalledWith("org-1", [...SHOWROOM_KPI_DEFAULT_ORDER], "showroom_suite"));
  });

  it("hides the team-default controls from an ordinary member", () => {
    renderDialog({ canManageTeamDefault: false });
    expect(screen.queryByTestId("kpi-customize-save-team-default")).toBeNull();
  });

  it("resets the personal layout for this surface only", async () => {
    renderDialog({ hasPersonal: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset to team default" }));
    await waitFor(() => expect(actions.resetPersonal).toHaveBeenCalledWith("org-1", "showroom_suite"));
  });
});

describe("KpiCustomizeDialog on the production home surface (unchanged default)", () => {
  it("still caps at eight and saves against the home surface", async () => {
    renderDialog({
      surface: undefined,
      availableKeys: SYSTEM_DEFAULT_KPI_ORDER,
      initialOrder: SYSTEM_DEFAULT_KPI_ORDER,
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalled());
    expect(actions.setPersonal).toHaveBeenCalledWith("org-1", SYSTEM_DEFAULT_KPI_ORDER, "home");
  });
});
