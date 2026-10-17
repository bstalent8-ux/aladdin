import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import type { ApplicationRow } from "@/lib/workspace/applications";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const submit = vi.fn(async (..._a: unknown[]) => ({ ok: true as boolean, code: undefined as string | undefined }));
const abandon = vi.fn(async (..._a: unknown[]) => ({ ok: true as boolean, code: undefined as string | undefined }));
const names = vi.fn(async (..._a: unknown[]) => ({ ok: true as boolean, code: undefined as string | undefined }));
vi.mock("@/server/actions/organization-application", () => ({
  submitOrganizationApplication: (id: string) => submit(id),
  abandonOrganizationApplication: (id: string) => abandon(id),
  updateApplicationNames: (i: unknown) => names(i),
}));
const selectWorkspace = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/server/actions/context", () => ({ selectWorkspace: (v: string) => selectWorkspace(v) }));

import { ApplicationCenter } from "./application-center";

const row = (over: Partial<ApplicationRow>): ApplicationRow => ({
  organizationId: "o1",
  name: "Nile Office",
  orgType: "design_office",
  status: "draft",
  reason: null,
  submittedAt: null,
  decidedAt: null,
  canSubmit: false,
  canAbandon: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("ApplicationCenter", () => {
  it("lists approved organizations and open applications in separate groups", () => {
    renderWithI18n(
      <ApplicationCenter
        slot="additional_pending"
        rows={[
          row({ organizationId: "a", name: "Approved Co", status: "approved" }),
          row({ organizationId: "b", name: "Pending Co", status: "pending_review" }),
        ]}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: en.orgApplications.title })).toBeTruthy();
    expect(screen.getByText("Approved Co")).toBeTruthy();
    expect(screen.getByText("Pending Co")).toBeTruthy();
    // Only the approved one can be opened as a workspace; the pending one has no such control.
    expect(screen.getAllByRole("button", { name: en.orgApplications.approved.open })).toHaveLength(1);
    expect(screen.getByTestId("not-a-workspace-note").textContent).toBe(en.orgApplications.notWorkspace);
  });

  it("opening an approved organization selects that workspace", async () => {
    renderWithI18n(<ApplicationCenter slot="additional_available" rows={[row({ organizationId: "a", status: "approved" })]} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en.orgApplications.approved.open }));
    await waitFor(() => expect(selectWorkspace).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/b2b"));
  });

  it("explains why another application is blocked and offers no start link", () => {
    renderWithI18n(<ApplicationCenter slot="additional_pending" rows={[row({ status: "pending_review" })]} />, "en");
    expect(screen.getByTestId("application-blocked").textContent).toBe(en.orgApplications.blocked.additionalPending);
    expect(screen.queryByRole("link", { name: en.orgApplications.actions.addAnother })).toBeNull();
  });

  it.each([
    ["first_pending", en.orgApplications.blocked.firstPending],
    ["first_rejected", en.orgApplications.blocked.firstRejected],
    ["not_entitled", en.orgApplications.blocked.notEntitled],
  ] as const)("slot %s shows its reason", (slot, text) => {
    renderWithI18n(<ApplicationCenter slot={slot} rows={[]} />, "en");
    expect(screen.getByTestId("application-blocked").textContent).toBe(text);
  });

  it("offers to start the first application, or add another once one is approved", () => {
    const { unmount } = renderWithI18n(<ApplicationCenter slot="first_available" rows={[]} />, "en");
    expect(screen.getByRole("link", { name: en.orgApplications.actions.startNew }).getAttribute("href")).toBe("/business/new");
    unmount();
    renderWithI18n(<ApplicationCenter slot="additional_available" rows={[row({ status: "approved" })]} />, "en");
    expect(screen.getByRole("link", { name: en.orgApplications.actions.addAnother }).getAttribute("href")).toBe("/business/new");
  });

  it("a draft can be submitted; a needs-changes application shows the reviewer note and resubmits", async () => {
    renderWithI18n(
      <ApplicationCenter
        slot="additional_pending"
        rows={[row({ status: "needs_changes", reason: "Add a branch address.", canSubmit: true, canAbandon: true })]}
      />,
      "en",
    );
    expect(screen.getByTestId("reviewer-note").textContent).toContain("Add a branch address.");
    fireEvent.click(screen.getByRole("button", { name: en.orgApplications.actions.resubmit }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("o1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a rejected application can be abandoned only after confirmation, and keeps its reason visible", async () => {
    renderWithI18n(
      <ApplicationCenter slot="first_rejected" rows={[row({ status: "rejected", reason: "Licence missing.", canAbandon: true })]} />,
      "en",
    );
    expect(screen.getByTestId("reviewer-note").textContent).toContain("Licence missing.");
    expect(screen.queryByRole("button", { name: en.orgApplications.actions.resubmit })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.orgApplications.actions.abandon }));
    expect(abandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: en.orgApplications.actions.abandonYes }));
    await waitFor(() => expect(abandon).toHaveBeenCalledWith("o1"));
  });

  it("an application awaiting review has neither submit nor abandon", () => {
    renderWithI18n(<ApplicationCenter slot="first_pending" rows={[row({ status: "pending_review" })]} />, "en");
    expect(screen.queryByRole("button", { name: en.orgApplications.actions.submit })).toBeNull();
    expect(screen.queryByRole("button", { name: en.orgApplications.actions.abandon })).toBeNull();
  });

  it("a server refusal is shown as the specific reason", async () => {
    submit.mockResolvedValueOnce({ ok: false, code: "orgApplications.error.additional_pending" });
    renderWithI18n(<ApplicationCenter slot="first_available" rows={[row({ status: "draft", canSubmit: true })]} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en.orgApplications.actions.submit }));
    await waitFor(() => expect(screen.getByText(en.orgApplications.error.additional_pending)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("abandoned applications move to history and keep no actions", () => {
    renderWithI18n(<ApplicationCenter slot="first_available" rows={[row({ status: "abandoned", reason: "Licence missing." })]} />, "en");
    expect(screen.getByText(en.orgApplications.history.title)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.orgApplications.actions.abandon })).toBeNull();
  });

  it("renders in Arabic RTL with the same structure", () => {
    renderWithI18n(<ApplicationCenter slot="additional_pending" rows={[row({ status: "pending_review" })]} />, "ar");
    expect(screen.getByRole("heading", { name: ar.orgApplications.title })).toBeTruthy();
    expect(screen.getByTestId("application-blocked").textContent).toBe(ar.orgApplications.blocked.additionalPending);
  });
});
