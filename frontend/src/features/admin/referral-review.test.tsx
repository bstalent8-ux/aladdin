import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import type { AdminReferralRow } from "@/server/queries/affiliation";

vi.mock("@/server/actions/affiliation", () => ({ approveReferral: vi.fn(), rejectReferral: vi.fn() }));

import { ReferralReview } from "./referral-review";

const row = (over: Partial<AdminReferralRow> = {}): AdminReferralRow => ({
  id: "r1",
  displayName: "Zayed Tiles",
  legalName: null,
  orgType: "showroom_dealer",
  description: null,
  governorate: "giza",
  city: "sheikh_zayed",
  primaryBranchName: "Zayed Main",
  status: "submitted",
  reason: null,
  organizationId: null,
  organizationName: null,
  referrerName: "Youssef",
  referrerEmail: "youssef@example.test",
  referrerPersona: "sales",
  createdAt: "2026-10-11T00:00:00Z",
  matchCount: 0,
  matchId: null,
  matchName: null,
  ...over,
});

const legalField = () => screen.getByLabelText(new RegExp(`^${en.admin.referrals.approveLegalNameLabel}`)) as HTMLInputElement;

describe("Admin referral review - the legal name of a NEW business", () => {
  it("asks the Admin for the legal / registered name, required, in the approve-as-new form", () => {
    render(<ReferralReview rows={[row()]} m={en} locale="en" canDecide />);
    const input = legalField();
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("name", "legalName");
    expect(input.value).toBe("");
    expect(screen.getByText(en.admin.referrals.approveLegalNameHint)).toBeInTheDocument();
    const form = input.closest("form")!;
    expect(within(form).getByRole("button", { name: en.admin.referrals.approveNew })).toBeInTheDocument();
  });

  it("prefills the legal name when the referrer already supplied one", () => {
    render(<ReferralReview rows={[row({ legalName: "Zayed Tiles Trading LLC" })]} m={en} locale="en" canDecide />);
    expect(legalField().value).toBe("Zayed Tiles Trading LLC");
  });

  it("linking to an existing organization asks for NOTHING (no legal-name field in that form)", () => {
    render(<ReferralReview rows={[row({ matchId: "org-1", matchName: "Zayed Tiles", matchCount: 1 })]} m={en} locale="en" canDecide />);
    const link = screen.getByRole("button", { name: en.admin.referrals.linkExisting }).closest("form")!;
    expect(within(link).queryByLabelText(new RegExp(en.admin.referrals.approveLegalNameLabel))).not.toBeInTheDocument();
    expect(link.querySelector('input[name="legalName"]')).toBeNull();
    // ...while the approve-as-new form still requires it
    expect(legalField()).toBeRequired();
  });

  it("an already-decided referral shows no approval form", () => {
    render(<ReferralReview rows={[row({ status: "approved", organizationName: "Zayed Tiles" })]} m={en} locale="en" canDecide />);
    expect(screen.queryByLabelText(new RegExp(en.admin.referrals.approveLegalNameLabel))).not.toBeInTheDocument();
  });

  it("offers an optional branch-location correction in the approve-new form only", () => {
    render(<ReferralReview rows={[row({ matchId: "org-1", matchName: "Zayed Tiles", matchCount: 1 })]} m={en} locale="en" canDecide />);
    const gov = screen.getByLabelText(new RegExp(en.admin.referrals.approveLocationLabel.slice(0, 16))) as HTMLSelectElement;
    expect(gov).toHaveAttribute("name", "governorate");
    expect(gov).not.toHaveAttribute("required");
    expect(gov.value).toBe("");
    expect(gov.closest("form")).toBe(legalField().closest("form"));
    const link = screen.getByRole("button", { name: en.admin.referrals.linkExisting }).closest("form")!;
    expect(link.querySelector('select[name="governorate"]')).toBeNull();
  });

  it("is bilingual", () => {
    expect(en.admin.referrals.approveLegalNameLabel).toBe("Legal / registered name");
    expect(ar.admin.referrals.approveLegalNameLabel).toBe("الاسم القانوني / الرسمي");
    expect(ar.admin.referrals.legalNameRequired.length).toBeGreaterThan(10);
    render(<ReferralReview rows={[row()]} m={ar} locale="ar" canDecide />);
    expect(screen.getByLabelText(new RegExp(`^${ar.admin.referrals.approveLegalNameLabel}`))).toBeRequired();
  });
});
