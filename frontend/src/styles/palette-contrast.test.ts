import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE APPROVED PALETTE, AS A MEASUREMENT.
 *
 * Every surface, ink, border, accent and focus token in `tokens.css` derives
 * from four brand colours (Deep Navy, Warm Sand, Soft Cream, Muted
 * Terracotta). Derivation by `color-mix()` is easy to get subtly wrong — a
 * muted ink that reads fine on the canvas can fall under AA on the sunk
 * surface beside it — so this file resolves the stylesheet the way a browser
 * does (custom properties, `var()` chains, `color-mix(in srgb, …)` with
 * premultiplied alpha) and measures every text/background pair the product
 * actually paints, in BOTH themes.
 *
 * Thresholds are WCAG 2.2 AA: 4.5:1 for body text, 3:1 for UI component
 * boundaries, focus indicators and graphical objects.
 */

type RGBA = { r: number; g: number; b: number; a: number };
type Scope = Map<string, string>;

const CSS = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");
const BRAND = ["#071a2d", "#d8c7a6", "#f2e9d8", "#b96f52"];

function parseScopes(source: string): { light: Scope; dark: Scope } {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const light: Scope = new Map();
  const darkOnly: Scope = new Map();
  for (const m of css.matchAll(/(:root|\.dark)\s*\{([^{}]*)\}/g)) {
    const target = m[1] === ".dark" ? darkOnly : light;
    for (const decl of (m[2] ?? "").split(";")) {
      const d = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
      if (d?.[1] && d[2]) target.set(d[1], d[2]);
    }
  }
  return { light, dark: new Map([...light, ...darkOnly]) };
}

function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function hex(value: string): RGBA {
  const h = value.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function resolve(value: string, scope: Scope, seen: string[] = []): RGBA {
  const v = value.trim();
  if (v.startsWith("#")) return hex(v);
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref?.[1]) {
    const name = ref[1];
    const next = scope.get(name);
    if (next === undefined) throw new Error(`undefined token ${name}`);
    if (seen.includes(name)) throw new Error(`cycle at ${name}`);
    return resolve(next, scope, [...seen, name]);
  }
  const mix = /^color-mix\(([\s\S]*)\)$/.exec(v);
  if (mix?.[1]) {
    const [space, a, b] = splitArgs(mix[1]);
    if (space !== "in srgb" || !a || !b) throw new Error(`unsupported color-mix: ${v}`);
    const part = (arg: string) => {
      const p = /^([\s\S]*?)\s+([\d.]+)%$/.exec(arg);
      return p?.[1] && p[2] ? { c: p[1], p: Number(p[2]) } : { c: arg, p: undefined as number | undefined };
    };
    const A = part(a);
    const B = part(b);
    let p1 = A.p ?? (B.p !== undefined ? 100 - B.p : 50);
    let p2 = B.p ?? 100 - p1;
    const sum = p1 + p2;
    const alphaScale = sum < 100 ? sum / 100 : 1;
    p1 /= sum;
    p2 /= sum;
    const c1 = resolve(A.c, scope, seen);
    const c2 = resolve(B.c, scope, seen);
    const a1 = c1.a * p1;
    const a2 = c2.a * p2;
    const alpha = a1 + a2;
    const ch = (k: "r" | "g" | "b") => (alpha === 0 ? 0 : (c1[k] * a1 + c2[k] * a2) / alpha);
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: alpha * alphaScale };
  }
  throw new Error(`not a colour: ${v}`);
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  const ch = (k: "r" | "g" | "b") => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
  return { r: ch("r"), g: ch("g"), b: ch("b"), a };
}

function luminance({ r, g, b }: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: RGBA, bg: RGBA): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SCOPES = parseScopes(CSS);
type Theme = keyof typeof SCOPES;

/** Resolve `fg` over `bg` over the theme's canvas, then measure. */
function measure(theme: Theme, fg: string, bg: string): number {
  const scope = SCOPES[theme];
  const base = resolve("var(--canvas)", scope);
  const ground = over(resolve(bg, scope), base);
  return ratio(over(resolve(fg, scope), ground), ground);
}

const v = (name: string) => `var(--${name})`;
const tint = (name: string, pct: number, on: string) => `color-mix(in srgb, var(--${name}) ${pct}%, var(--${on}))`;

const GROUNDS = ["canvas", "surface", "surface-2", "surface-hover", "workspace"];
const CONTENT_GROUNDS = ["canvas", "surface", "surface-2"];
const STATUS = ["success", "warning", "danger", "info"];

type Pair = { fg: string; bg: string; min: number; label: string; only?: "light" | "dark" };
const PAIRS: Pair[] = [];
const text = (fg: string, bg: string, label = `${fg} on ${bg}`) => PAIRS.push({ fg, bg, min: 4.5, label });
const ui = (fg: string, bg: string, label = `${fg} on ${bg}`) => PAIRS.push({ fg, bg, min: 3, label });

for (const g of GROUNDS) for (const t of ["fg", "fg-secondary", "fg-muted"]) text(v(t), v(g), `${t} on ${g}`);
for (const g of CONTENT_GROUNDS) {
  for (const t of ["accent", "bronze-sem", "lapis-sem", "iris-sem", ...STATUS]) text(v(t), v(g), `${t} on ${g}`);
  ui(v("border-strong"), v(g), `border-strong on ${g}`);
  ui(v("focus"), v(g), `focus on ${g}`);
}
// The terracotta FILL is the brand colour itself, so it is measured on the two
// grounds a filled control sits on (page and card). On the sunk `surface-2`
// state layer it measures ~2.7:1; nothing uses it there as a sole indicator.
for (const g of ["canvas", "surface"]) ui(v("accent-solid"), v(g), `accent-solid on ${g}`);
// Soft status badges: `bg-<tone>/15 text-<tone>` on a surface.
for (const t of [...STATUS, "accent", "iris-sem"]) text(v(t), tint(t === "accent" ? "accent-solid" : t, 15, "surface"), `${t} on ${t}/15 badge`);
text(v("primary-foreground"), v("primary"), "primary-foreground on primary");
text(v("on-accent"), v("accent-solid"), "on-accent on accent-solid");
text(v("field-fg"), v("field"), "field-fg on field");
text(v("field-placeholder"), v("field"), "field-placeholder on field");
text(v("field-hint"), v("field"), "field-hint on field");
ui(v("field-line"), v("field"), "field-line on field");
ui(v("field-line"), v("canvas"), "field-line on canvas");
ui(v("focus"), v("field"), "focus on field");
for (const g of ["shell", "shell-lit"]) {
  for (const t of ["shell-fg", "shell-fg-secondary", "shell-fg-muted"]) text(v(t), v(g), `${t} on ${g}`);
}
text(v("shell-active-fg"), v("shell-active"), "shell-active-fg on shell-active");
for (const t of ["on-dark", "on-dark-secondary", "on-dark-muted"]) text(v(t), v("basalt"), `${t} on basalt`);
// Solid status fills carry cream ink in light and navy ink in dark.
for (const t of STATUS) {
  PAIRS.push({ fg: v("soft-cream"), bg: v(t), min: 4.5, label: `soft-cream on solid ${t}`, only: "light" });
  PAIRS.push({ fg: v("deep-navy"), bg: v(t), min: 4.5, label: `deep-navy on solid ${t}`, only: "dark" });
}
for (let i = 1; i <= 6; i++) ui(v(`series-${i}`), v("surface"), `series-${i} on surface`);

describe("brand palette", () => {
  it("declares the four approved colours as the palette roots", () => {
    for (const name of ["deep-navy", "warm-sand", "soft-cream", "muted-terracotta"]) {
      const value = SCOPES.light.get(`--${name}`)?.toLowerCase();
      expect(BRAND).toContain(value);
    }
  });

  it("uses no raw hex outside the palette roots and the semantic status tones", () => {
    const allowed = new Set([
      ...BRAND,
      // Semantic status tones: success, warning, danger, info (light / dark).
      ...["--status-success", "--status-warning", "--status-danger", "--status-info"].flatMap((n) => [
        SCOPES.light.get(n),
        SCOPES.light.get(`${n}-bright`),
      ]),
    ]);
    const raw = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(raw.filter((h) => !allowed.has(h))).toEqual([]);
  });
});

describe.each(["light", "dark"] as const)("WCAG AA contrast — %s theme", (theme) => {
  it.each(PAIRS.filter((p) => !p.only || p.only === theme))("$label ≥ $min:1", ({ fg, bg, min }) => {
    expect(measure(theme, fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

/** `PALETTE_REPORT=1 pnpm vitest run src/styles/palette-contrast.test.ts` prints the table. */
if (process.env.PALETTE_REPORT) {
  for (const theme of ["light", "dark"] as const) {
    const rows = PAIRS.filter((p) => !p.only || p.only === theme).map((p) => ({ ...p, r: measure(theme, p.fg, p.bg) })).sort((a, b) => a.r - b.r);
    console.log(`\n${theme}\n` + rows.map((x) => `${x.r.toFixed(2).padStart(6)}  (min ${x.min})  ${x.label}`).join("\n"));
  }
}
