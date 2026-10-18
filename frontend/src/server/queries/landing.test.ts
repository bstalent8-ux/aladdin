import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";

vi.mock("server-only", () => ({}));

const { loadIsAdminStaff } = vi.hoisted(() => ({ loadIsAdminStaff: vi.fn() }));
vi.mock("@/server/queries/platform", () => ({ loadIsAdminStaff }));

// The mandatory-first-business rule has its own tests (business-setup.test.ts); here it is a controllable answer.
const { computeMandatoryBusinessSetup } = vi.hoisted(() => ({ computeMandatoryBusinessSetup: vi.fn() }));
vi.mock("@/server/queries/business-setup", () => ({ computeMandatoryBusinessSetup }));

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: undefined as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { resolveActiveLanding } from "./landing";

// The my_workspaces() row shape: a Personal row carries a `persona` and a Business
// row an `org_type`, in separate columns of separate types (Sprint 13).
type Row = {
  kind: string;
  organization_id: string | null;
  name: string;
  persona: string | null;
  org_type: string | null;
  relationship: string | null;
  is_approved: boolean;
};

const personal: Row = {
  kind: "personal",
  organization_id: null,
  name: "Ahmed Hassan",
  persona: "engineer",
  org_type: null,
  relationship: null,
  is_approved: true,
};
const business = (id: string, name: string): Row => ({
  kind: "business",
  organization_id: id,
  name,
  persona: null,
  org_type: "showroom_dealer",
  relationship: "owner",
  is_approved: true,
});
// An organization still under review: an application, never a workspace.
const pendingBusiness = (id: string, name: string): Row => ({ ...business(id, name), is_approved: false });

function clientWithWorkspaces(rows: Row[]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadIsAdminStaff.mockResolvedValue(false);
  computeMandatoryBusinessSetup.mockResolvedValue({ required: false, orgType: null });
  cookieValue.current = undefined;
});

describe("resolveActiveLanding", () => {
  it("routes platform staff to /admin without consulting workspaces", async () => {
    const { client, rpc } = clientWithWorkspaces([business("org-1", "Cairo Ceramics")]);
    loadIsAdminStaff.mockResolvedValueOnce(true);

    await expect(resolveActiveLanding(client)).resolves.toBe("/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("routes a BUSINESS-ONLY identity to /b2b — never a fake personal home", async () => {
    // No personal entry at all: the person has no personal persona.
    const { client } = clientWithWorkspaces([business("org-1", "Cairo Ceramics")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("a pending-only identity lands in its LIMITED workspace (profile, settings, draft products)", async () => {
    cookieValue.current = "org-pending";
    const { client } = clientWithWorkspaces([pendingBusiness("org-pending", "Under Review")]);
    // Product decision (rc2): a pending owner works in a limited workspace; the database withholds every commercial authority.
    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("an approved organization stays the default workspace when a pending application sits beside it", async () => {
    cookieValue.current = undefined;
    const { client } = clientWithWorkspaces([
      pendingBusiness("org-pending", "Under Review"),
      business("org-ok", "Cairo Ceramics"),
    ]);
    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("routes a personal-only identity to /home", async () => {
    const { client } = clientWithWorkspaces([personal]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });

  it("prefers Personal for a mixed identity with no valid selection", async () => {
    // Owning a business no longer evicts a person from their personal home.
    const { client } = clientWithWorkspaces([personal, business("org-1", "AH Design Studio")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });

  it("honors an explicit business selection for a mixed identity", async () => {
    cookieValue.current = "org-1";
    const { client } = clientWithWorkspaces([personal, business("org-1", "AH Design Studio")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("falls back safely when the selected workspace is no longer available", async () => {
    // The cookie names an org whose membership was revoked: it is simply not in
    // the caller's entries any more, so landing resolves to what they do have.
    cookieValue.current = "org-revoked";
    const { client } = clientWithWorkspaces([business("org-2", "Delta Wholesale")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("sends a caller with no usable workspace to the account-safe /home", async () => {
    const { client } = clientWithWorkspaces([]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });
});

describe("resolveActiveLanding - a business registration whose first business is outstanding", () => {
  it("routes to the mandatory business onboarding, never to /home (no generic Personal fallback)", async () => {
    computeMandatoryBusinessSetup.mockResolvedValueOnce({ required: true, orgType: "showroom_dealer" });
    const { client, rpc } = clientWithWorkspaces([]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/onboarding/business");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("applies to every approved business type (the type is carried by onboarding data, not the destination)", async () => {
    for (const orgType of ["showroom_dealer", "supplier", "manufacturer", "importer"]) {
      computeMandatoryBusinessSetup.mockResolvedValueOnce({ required: true, orgType });
      await expect(resolveActiveLanding(clientWithWorkspaces([]).client)).resolves.toBe("/onboarding/business");
    }
  });

  it("platform staff are still routed to /admin first", async () => {
    loadIsAdminStaff.mockResolvedValueOnce(true);
    computeMandatoryBusinessSetup.mockResolvedValue({ required: true, orgType: "supplier" });
    await expect(resolveActiveLanding(clientWithWorkspaces([]).client)).resolves.toBe("/admin");
  });

  it("once the first organization exists the business workspace is canonical: /b2b, not /home", async () => {
    computeMandatoryBusinessSetup.mockResolvedValue({ required: false, orgType: null });
    const { client } = clientWithWorkspaces([business("org-1", "Nile Showroom")]);
    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("leaves everyone else unchanged: an installer/sales/engineer-with-business keeps /home", async () => {
    computeMandatoryBusinessSetup.mockResolvedValue({ required: false, orgType: null });
    await expect(resolveActiveLanding(clientWithWorkspaces([{ ...personal, persona: "installer_technician" }]).client)).resolves.toBe("/home");
    await expect(resolveActiveLanding(clientWithWorkspaces([{ ...personal, persona: "sales" }]).client)).resolves.toBe("/home");
    await expect(resolveActiveLanding(clientWithWorkspaces([personal, business("org-1", "AH Showroom")]).client)).resolves.toBe("/home");
  });
});
