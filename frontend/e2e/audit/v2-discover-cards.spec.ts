import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { IDENTITIES, signIn } from "../helpers/auth";
import { prefs, expectNoHorizontalOverflow } from "../regression/util";

/** Product Discovery cards on Showroom Home: own bordered card, equal heights, bottom-aligned action, terracotta hover. */
test.describe.configure({ mode: "serial" });
const SHOTS = path.resolve(process.cwd(), "../docs/frontend/screenshots/v2-reference-alignment/v2-release");
const HOME = "/showroom/home";

async function openHome(page: Page, locale: "ar" | "en", theme: "light" | "dark", w: number, h: number) {
  await prefs(page, { locale, theme });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(HOME);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showroom-discover-rail")).toBeVisible();
}

async function geometry(page: Page) {
  return page.getByTestId("showroom-discover-card").evaluateAll((cards) =>
    cards.map((c) => {
      const r = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      const link = c.querySelector("a")!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, linkBottom: link.bottom, border: s.borderTopWidth, radius: s.borderTopLeftRadius, scrollW: c.scrollWidth, clientW: c.clientWidth };
    }),
  );
}

for (const [locale, theme, w, h, name] of [
  ["ar", "light", 1440, 900, "desktop.ar.light.1440x900"],
  ["en", "dark", 1440, 900, "desktop.en.dark.1440x900"],
  ["ar", "dark", 390, 844, "mobile.ar.dark.390x844"],
  ["en", "light", 430, 932, "mobile.en.light.430x932"],
] as const) {
  test(`DC ${name}: each product is its own bordered card`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await signIn(page, request, IDENTITIES.showroom);
    await openHome(page, locale, theme, w, h);
    const g = await geometry(page);
    expect(g.length).toBe(6);
    for (const c of g) {
      expect(c.border).toBe("1px");
      expect(c.radius).toBe("12px");
      expect(c.scrollW).toBeLessThanOrEqual(c.clientW + 1); // nothing overflows the card
    }
    // consistent heights, and the action button ends at the same distance from the bottom edge in every card
    expect(new Set(g.map((c) => Math.round(c.h))).size).toBe(1);
    expect(new Set(g.map((c) => Math.round(c.bottom - c.linkBottom))).size).toBe(1);
    // separation between neighbours on the same row is 16px
    const row = g.filter((c) => Math.abs(c.top - g[0]!.top) < 2).sort((a, b) => a.left - b.left);
    for (let i = 1; i < row.length; i += 1) expect(Math.round(row[i]!.left - row[i - 1]!.right)).toBeGreaterThanOrEqual(12);
    if (w < 768) await expectNoHorizontalOverflow(page, `discover @${w}`);
    const rail = page.getByTestId("showroom-discover-rail");
    await rail.scrollIntoViewIfNeeded();
    await rail.screenshot({ path: path.join(SHOTS, `discover-cards.${name}.png`) });
    if (w >= 1024) {
      const first = page.getByTestId("showroom-discover-card").first();
      const before = await first.evaluate((el) => getComputedStyle(el).borderTopColor);
      await first.hover();
      await page.waitForTimeout(400);
      const after = await first.evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(after).not.toBe(before);
      await rail.screenshot({ path: path.join(SHOTS, `discover-cards-hover.${name}.png`) });
    } else {
      // the horizontal rail still scrolls on phones
      expect(await rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
  });
}
