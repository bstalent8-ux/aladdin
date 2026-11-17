import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * Each Admin area states honestly what it is. Live data must not sit under the "planned experience" banner; areas that are
 * still fixtures or Preview dialogs keep it.
 */
const pathname = { value: "/admin" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/features/admin-preview/command-palette", () => ({ CommandPalette: () => null }));

const { PreviewShell } = await import("./preview-shell");
const P = en.admin.preview;

function titleAt(path: string, locale: "en" | "ar" = "en"): string {
  pathname.value = path;
  render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <PreviewShell paletteItems={[]}>
        <p>content</p>
      </PreviewShell>
    </I18nProvider>,
  );
  const note = screen.queryByRole("note");
  const text = note?.querySelector("p")?.textContent ?? "";
  cleanup();
  return text;
}
afterEach(cleanup);

describe("PreviewShell banners", () => {
  it.each(["/admin", "/admin/review", "/admin/business-verification"])("%s is live, read-only data (not a mock-up)", (path) => {
    expect(titleAt(path)).toBe(P.liveDataBannerTitle);
  });

  it("a Business verification DETAIL page (real, audited decisions) is Live, not a preview and not read-only", () => {
    expect(titleAt("/admin/business-verification/abc")).toBe(P.liveBannerTitle);
  });

  it("keeps the existing live-read and live banners", () => {
    expect(titleAt("/admin/users")).toBe(P.liveReadBannerTitle);
    expect(titleAt("/admin/organizations/abc")).toBe(P.liveReadBannerTitle);
    expect(titleAt("/admin/staff")).toBe(P.liveBannerTitle);
  });

  it("areas that are still fixtures or Preview dialogs keep the Preview banner", () => {
    for (const path of ["/admin/analytics", "/admin/points", "/admin/settings", "/admin/review/network-referral/x"]) {
      expect(titleAt(path)).toBe(P.bannerTitle);
    }
  });

  it("the classic Verifications queue carries no banner at all", () => {
    pathname.value = "/admin/verifications";
    const { container } = render(
      <I18nProvider locale="en" dir="ltr">
        <PreviewShell paletteItems={[]}>
          <p>content</p>
        </PreviewShell>
      </I18nProvider>,
    );
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it("the new live-data banner is translated and says read-only in both languages", () => {
    expect(titleAt("/admin", "ar")).toBe(ar.admin.preview.liveDataBannerTitle);
    expect(en.admin.preview.liveDataBannerBody).toMatch(/read live/i);
    expect(ar.admin.preview.liveDataBannerBody.length).toBeGreaterThan(10);
  });
});
