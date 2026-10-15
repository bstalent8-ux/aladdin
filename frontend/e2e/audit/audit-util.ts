import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Evidence helpers for the frontend reality audit. Screenshots are REAL captures of the running
 * app; every capture appends one manifest line (route, persona, locale, theme, viewport, state,
 * whether real backend data was on screen, limitation) so the audit document is generated from
 * what actually happened, not from memory.
 */
// SHOT_ROOT_NAME lets the V2 release evidence land beside (never inside) the untouched M4 audit archive.
export const SHOT_ROOT = path.resolve(process.cwd(), "..", "docs", "frontend", "screenshots", process.env.SHOT_ROOT_NAME ?? "m4-audit");
export const MANIFEST = path.join(SHOT_ROOT, "manifest.jsonl");

export type Area = "v2-release" | "m2-registration-applications" | "m3-organization-branch-governance" | "m4a-independent-publishing" | "existing-showroom-commerce";

export type ShotMeta = {
  area: Area;
  name: string; // file stem
  persona: string;
  locale: "en" | "ar";
  theme: "light" | "dark";
  state: string;
  data: "real" | "empty-state" | "error";
  limitation?: string;
  fullPage?: boolean;
};

export async function shot(page: Page, m: ShotMeta) {
  const dir = path.join(SHOT_ROOT, m.area);
  mkdirSync(dir, { recursive: true });
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const file = `${m.name}.${m.locale}.${m.theme}.${vp.width}x${vp.height}.png`;
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, file), fullPage: m.fullPage ?? false, animations: "disabled" });
  const u = new URL(page.url());
  appendFileSync(
    MANIFEST,
    JSON.stringify({
      file: `${m.area}/${file}`,
      route: u.pathname + (u.search ? u.search : ""),
      persona: m.persona,
      locale: m.locale,
      theme: m.theme,
      viewport: `${vp.width}x${vp.height}`,
      state: m.state,
      data: m.data,
      limitation: m.limitation ?? "",
      fullPage: m.fullPage ?? false,
    }) + "\n",
  );
}

/** Route health record for the sweep. */
export type RouteRecord = {
  route: string;
  persona: string;
  status: number;
  finalPath: string;
  consoleErrors: string[];
  overflowPx: number;
  dir: string | null;
  h1: string;
  bodyChars: number;
  notFoundShell: boolean;
};

export function appendRoute(r: RouteRecord) {
  mkdirSync(SHOT_ROOT, { recursive: true });
  appendFileSync(path.join(SHOT_ROOT, "routes.jsonl"), JSON.stringify(r) + "\n");
}

import { prefs } from "../regression/util";

export type Combo = { locale: "en" | "ar"; theme: "light" | "dark"; w: number; h: number; fullPage?: boolean };
export const DESK_EN_L: Combo = { locale: "en", theme: "light", w: 1440, h: 900 };
export const DESK_AR_D: Combo = { locale: "ar", theme: "dark", w: 1440, h: 900 };
export const MOB_AR_D: Combo = { locale: "ar", theme: "dark", w: 390, h: 844 };
export const MOB_EN_L: Combo = { locale: "en", theme: "light", w: 390, h: 844 };

/**
 * Capture ONE route in several locale/theme/viewport combinations from the current signed-in session.
 * `before` (optional) runs after navigation so a state can be reached (open a dialog, switch a tab).
 * Returns the final path so a caller can notice a redirect (a redirect is itself a finding).
 */
export async function capture(
  page: Page,
  route: string,
  base: Omit<ShotMeta, "locale" | "theme" | "fullPage">,
  combos: Combo[],
  before?: (page: Page) => Promise<void>,
): Promise<string> {
  let finalPath = "";
  for (const c of combos) {
    await prefs(page, { locale: c.locale, theme: c.theme });
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    if (before) await before(page);
    finalPath = new URL(page.url()).pathname;
    await shot(page, { ...base, locale: c.locale, theme: c.theme, fullPage: c.fullPage });
  }
  return finalPath;
}
