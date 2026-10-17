import { expect, type Page } from "@playwright/test";

/** Locale / theme live only in cookies (never the URL). */
export async function prefs(page: Page, opts: { locale?: "en" | "ar"; theme?: "light" | "dark" } = {}) {
  const url = "http://127.0.0.1";
  const cookies: Array<{ name: string; value: string; url: string }> = [{ name: "NEXT_LOCALE", value: opts.locale ?? "en", url }];
  if (opts.theme) cookies.push({ name: "aladdin-theme", value: opts.theme, url });
  await page.context().addCookies(cookies);
}

/**
 * Collect every console error and page error. A page that "renders" while throwing is not done.
 * Resource 4xx noise from a deliberately denied request is filtered by the caller via `ignore`.
 */
export function guardConsole(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignore.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Open a route and require a successful response and a settled DOM. */
export async function open(page: Page, route: string) {
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${route} status`).toBeLessThan(400);
  await page.waitForLoadState("load");
  return res!;
}

/** Nothing may scroll the page sideways at any width. */
export async function expectNoHorizontalOverflow(page: Page, label = "") {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow ${label}`).toBeLessThanOrEqual(1);
}

/**
 * Every <img> that is actually RENDERED must have decoded real pixels (a broken image has width 0).
 * Lazy images are scrolled into view first; images that are not rendered (display:none decoration)
 * are not judged, because a browser never loads them.
 */
export async function expectImagesLoaded(page: Page, label = "") {
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) {
      if (img.offsetParent !== null && img.loading === "lazy") img.scrollIntoView({ block: "center" });
    }
  });
  await page
    .waitForFunction(
      () => Array.from(document.images).filter((i) => i.offsetParent !== null).every((i) => i.complete),
      null,
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((i) => i.offsetParent !== null && i.getBoundingClientRect().width > 0)
      .filter((i) => !i.complete || i.naturalWidth === 0)
      .map((i) => i.currentSrc || i.src),
  );
  expect(broken, `broken images ${label}`).toEqual([]);
}

/** The page-level direction the app set. */
export async function dirOf(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("dir"));
}
