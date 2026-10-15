import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { OrganizationDescriptionField } from "./organization-description-field";
import { saveOrganizationDescriptionAction } from "@/server/actions/organization-description";
import { ar } from "@/lib/i18n/messages/ar";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/server/actions/organization-description", () => ({
  saveOrganizationDescriptionAction: vi.fn(async (_orgId: string, raw: string) => ({ ok: true, value: raw.trim() || null })),
}));

const save = vi.mocked(saveOrganizationDescriptionAction);

describe("OrganizationDescriptionField", () => {
  beforeEach(() => {
    save.mockClear();
    refresh.mockClear();
  });

  it("shows the Arabic label, a live counter and saves the typed description", async () => {
    renderWithI18n(<OrganizationDescriptionField orgId="org-1" description={null} canManage />);
    expect(screen.getByLabelText(ar.showroomSettings.description.label)).toBeInTheDocument();
    expect(screen.getByTestId("organization-description-count-figure")).toHaveTextContent("0/250");

    const box = screen.getByLabelText(ar.showroomSettings.description.label) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "سجاد وأرضيات" } });
    expect(screen.getByTestId("organization-description-count-figure")).toHaveTextContent("12/250");

    fireEvent.click(screen.getByTestId("organization-description-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("org-1", "سجاد وأرضيات"));
    expect(await screen.findByText(ar.showroomSettings.description.saved)).toBeInTheDocument();
  });

  it("accepts 250 characters and blocks 251 with a clear message (nothing is truncated or sent)", () => {
    renderWithI18n(<OrganizationDescriptionField orgId="org-1" description={null} canManage />);
    const box = screen.getByLabelText(ar.showroomSettings.description.label) as HTMLTextAreaElement;
    const saveButton = screen.getByTestId("organization-description-save") as HTMLButtonElement;

    fireEvent.change(box, { target: { value: "ع".repeat(250) } });
    expect(screen.getByTestId("organization-description-count-figure")).toHaveTextContent("250/250");
    expect(saveButton.disabled).toBe(false);

    fireEvent.change(box, { target: { value: "ع".repeat(251) } });
    expect(screen.getByTestId("organization-description-count-figure")).toHaveTextContent("251/250");
    expect(box.value.length).toBe(251);
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText(ar.showroomSettings.description.errorTooLong.replace("{max}", "٢٥٠"))).toBeInTheDocument();
    fireEvent.click(saveButton);
    expect(save).not.toHaveBeenCalled();
  });

  it("counts an emoji as one character", () => {
    renderWithI18n(<OrganizationDescriptionField orgId="org-1" description={null} canManage />);
    fireEvent.change(screen.getByLabelText(ar.showroomSettings.description.label), { target: { value: "😀".repeat(250) } });
    expect(screen.getByTestId("organization-description-count-figure")).toHaveTextContent("250/250");
    expect((screen.getByTestId("organization-description-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("is read-only for a member without org.manage", () => {
    renderWithI18n(<OrganizationDescriptionField orgId="org-1" description="معرض سجاد" canManage={false} />);
    expect(screen.queryByTestId("organization-description-save")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("organization-description-readonly")).toHaveTextContent("معرض سجاد");
  });

  it("shows the server's refusal instead of claiming success", async () => {
    save.mockResolvedValueOnce({ ok: false, code: "forbidden" });
    renderWithI18n(<OrganizationDescriptionField orgId="org-1" description="old" canManage />);
    fireEvent.change(screen.getByLabelText(ar.showroomSettings.description.label), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("organization-description-save"));
    expect(await screen.findByText(ar.showroomSettings.description.errorForbidden)).toBeInTheDocument();
    expect(screen.queryByText(ar.showroomSettings.description.saved)).toBeNull();
  });
});
