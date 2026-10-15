import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ShowroomWorkspaceMenu } from "./workspace-menu";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./workspace-action", () => ({ selectShowroomWorkspace: vi.fn(async () => ({ ok: true })) }));

const entries = [
  { kind: "business" as const, organizationId: "org-1", name: "Cairo Ceramics Showroom", orgType: "showroom_dealer", relationship: "owner" as never },
];

describe("workspace switcher terminology", () => {
  it("uses the approved Arabic labels and the existing destinations", () => {
    renderWithI18n(<ShowroomWorkspaceMenu entries={entries} activeKey="org-1" canCreate />, "ar");
    fireEvent.click(screen.getByRole("button", { name: ar.workspace.switch }));
    const add = screen.getByRole("menuitem", { name: "طلب إضافة مؤسسة جديدة" });
    const mine = screen.getByRole("menuitem", { name: "مؤسساتي وطلباتي" });
    expect(add.getAttribute("href")).toBe("/showroom/add-business");
    expect(mine.getAttribute("href")).toBe("/business/applications");
    expect(screen.queryByText("إضافة نشاط تجاري")).toBeNull();
    expect(screen.queryByText("طلبات المؤسسات")).toBeNull();
  });

  it("uses the approved English labels", () => {
    renderWithI18n(<ShowroomWorkspaceMenu entries={entries} activeKey="org-1" canCreate />, "en");
    fireEvent.click(screen.getByRole("button", { name: en.workspace.switch }));
    expect(screen.getByRole("menuitem", { name: "Request New Organization" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "My Organizations & Applications" })).toBeTruthy();
    expect(screen.queryByText(/Add business activity|Organization applications$/)).toBeNull();
  });

  it("offers neither action to someone who may not create organizations, and lists only approved workspaces", () => {
    renderWithI18n(<ShowroomWorkspaceMenu entries={entries} activeKey="org-1" canCreate={false} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en.workspace.switch }));
    expect(screen.queryByRole("menuitem", { name: "Request New Organization" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "My Organizations & Applications" })).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("keeps the organization applications page and the legacy switcher on the same words", () => {
    expect(ar.orgApplications.title).toBe("مؤسساتي وطلباتي");
    expect(en.orgApplications.title).toBe("My Organizations & Applications");
    expect(ar.workspace.addBusiness).toBe("طلب إضافة مؤسسة جديدة");
    expect(en.workspace.addBusiness).toBe("Request New Organization");
  });
});
