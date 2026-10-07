import { describe, expect, it } from "vitest";
import { canNavigate, showroomNavigation, SHOWROOM_GROUPS, SHOWROOM_ROOT } from "./navigation";
import { eligibleWorkspaces, isShowroomBusinessType, SHOWROOM_BUSINESS_LABELS } from "./workspace-model";
import { BUSINESS_ORG_TYPES, businessOrgTypeFromAccountType, REGISTRATION_CHOICE_ORDER, CHOICE_GROUPS } from "@/lib/onboarding/account-types";
import type { WorkspaceEntry } from "@/lib/workspace/model";

describe("showroom phase 1 navigation", () => {
  const items = SHOWROOM_GROUPS.flatMap((group) => group.items);
  it("has the agreed group order, directional commerce and no institutions", () => {
    expect(SHOWROOM_GROUPS.map((group) => group.label.ar)).toEqual(["", "المشتريات", "المبيعات", "المنتجات", "الشبكة", "الفريق", "إدارة النشاط"]);
    expect(items.map((item) => item.id)).toEqual(["home", "purchase-requests", "pricing-requests-sent", "quotes-received", "purchase-orders", "customer-rfqs", "customer-quotes", "customers", "catalog", "saved", "my-products", "suppliers", "craftsmen", "jobs", "sales-team", "projects", "reports", "points", "settings"]);
    expect(items.every((item) => item.href === `${SHOWROOM_ROOT}/${item.id}`)).toBe(true);
  });
  it("filters nav and direct-page authorization with the same capability rule", () => {
    const visible = showroomNavigation([]).flatMap((group) => group.items);
    expect(visible.map((item) => item.id)).toEqual(["home", "suppliers", "craftsmen", "points", "settings"]);
    for (const item of items) expect(visible.includes(item)).toBe(canNavigate(item, []));
    expect(showroomNavigation(["org.manage"]).flatMap((group) => group.items)).toEqual(items);
    expect(showroomNavigation(["job.manage"]).flatMap((group) => group.items).some((item) => item.id === "jobs")).toBe(true);
    expect(showroomNavigation(["sales.manage"]).flatMap((group) => group.items).some((item) => item.id === "sales-team")).toBe(false);
  });
});

describe("canonical business mappings", () => {
  it("adds design_office without changing registration personas or the four business types", () => {
    expect(BUSINESS_ORG_TYPES).toEqual(["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"]);
    expect(businessOrgTypeFromAccountType("design_office")).toBe("design_office");
    expect(businessOrgTypeFromAccountType("engineer")).toBeNull();
    expect(SHOWROOM_BUSINESS_LABELS.design_office).toEqual({ ar: "المهندس", en: "Engineer" });
    expect(REGISTRATION_CHOICE_ORDER).not.toContain("design_office");
    expect(CHOICE_GROUPS.find((group) => group.group === "business")?.keys).toEqual(["showroom_dealer", "supplier", "manufacturer", "importer"]);
  });
  it("offers only supported actual business memberships, not synthetic types or personal contexts", () => {
    const entries: WorkspaceEntry[] = BUSINESS_ORG_TYPES.map((orgType, i) => ({ kind: "business", organizationId: String(i), name: orgType, orgType, relationship: "member" }));
    expect(eligibleWorkspaces([...entries, { kind: "personal", name: "Person", persona: "engineer" }])).toEqual(entries);
    expect(isShowroomBusinessType("engineer")).toBe(false);
    expect(isShowroomBusinessType("toString")).toBe(false);
    expect(isShowroomBusinessType(null)).toBe(false);
  });
});
