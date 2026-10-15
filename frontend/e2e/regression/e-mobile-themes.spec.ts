import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG } from "./setup";
import { expectImagesLoaded, expectNoHorizontalOverflow, guardConsole, open, prefs } from "./util";

/**
 * BATCH E - Mobile 430px and 390px, Light and Dark, critical pages.
 * A page passes only when: it loads without console errors, nothing scrolls sideways, every rendered
 * image decoded, and the RENDERED background actually matches the requested theme (measured from
 * computed colour, not from a class name).
 */
const SUITE = "/preview/showroom-suite-v2";
const WIDTHS = [430, 390] as const;
const THEMES = ["light", "dark"] as const;
const SHOWROOM_PAGES = [`${SUITE}/home`, `${SUITE}/catalog`, `${SUITE}/my-products`, `${SUITE}/offers`] as const;

test.describe.configure({ mode: "serial" });

/**
 * Relative luminance (0..1) of what is actually PAINTED behind the page content: the nearest opaque
 * background walking up from the element at a sample point (html/body are often transparent, with the
 * canvas colour on a wrapper). No opaque ancestor means the browser's white canvas.
 */
async function backgroundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Computed colours can be oklab()/color(); a 1x1 canvas converts any CSS colour to sRGB bytes.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const x = Math.max(2, window.innerWidth - 6);
    const y = Math.floor(window.innerHeight / 2);
    let el: Element | null = document.elementFromPoint(x, y);
    let rgba: [number, number, number, number] = [255, 255, 255, 1];
    while (el) {
      const c = toRgba(getComputedStyle(el).backgroundColor);
      if (c[3] > 0.95) {
        rgba = c;
        break;
      }
      el = el.parentElement;
    }
    const [r, g, b] = rgba.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  });
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      test(`E showroom critical pages @${width} ${theme}`, async ({ page, request }) => {
        await page.setViewportSize({ width, height: 844 });
        await prefs(page, { locale: "en", theme });
        await signIn(page, request, IDENTITIES.showroom);
        const errors = guardConsole(page);
        for (const route of SHOWROOM_PAGES) {
          await open(page, route);
          await expectNoHorizontalOverflow(page, `${route} @${width}`);
          const lum = await backgroundLuminance(page);
          if (theme === "dark") expect(lum, `${route} dark background`).toBeLessThan(0.25);
          else expect(lum, `${route} light background`).toBeGreaterThan(0.6);
        }
        await open(page, `${SUITE}/catalog`);
        await expect(page.getByText(REG.productName).first()).toBeVisible();
        await expectImagesLoaded(page, `catalog @${width} ${theme}`);
        expect(errors).toEqual([]);
      });

      test(`E applications page @${width} ${theme}`, async ({ page, request }) => {
        await page.setViewportSize({ width, height: 844 });
        await prefs(page, { locale: "en", theme });
        await signIn(page, request, REG.multiEmail, /\/(b2b|home)(\/|$)/);
        const errors = guardConsole(page);
        await open(page, "/business/applications");
        await expectNoHorizontalOverflow(page, `applications @${width}`);
        const lum = await backgroundLuminance(page);
        if (theme === "dark") expect(lum).toBeLessThan(0.25);
        else expect(lum).toBeGreaterThan(0.6);
        await expect(page.getByTestId("application-center")).toBeVisible();
        expect(errors).toEqual([]);
      });
    });
  }
}
