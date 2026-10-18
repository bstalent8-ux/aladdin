// Builds docs/frontend/screenshots/m4-review-pack/contact-sheet.png from the pack manifest and
// verifies that every exported image decodes. Run from frontend/: node e2e/audit/contact-sheet.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = path.resolve(process.cwd(), "..", "docs", "frontend", "screenshots", "m4-review-pack");
const rows = JSON.parse(readFileSync(path.join(OUT, "manifest.json"), "utf8"));
const missing = rows.filter((r) => !existsSync(path.join(OUT, r.file)) || statSync(path.join(OUT, r.file)).size < 1000);
if (missing.length) throw new Error("missing or empty: " + missing.map((r) => r.file).join(", "));

const cells = rows
  .map(
    (r) => `<figure><div class="img"><img src="${pathToFileURL(path.join(OUT, r.file)).href}"></div>
<figcaption><b>${String(r.index).padStart(2, "0")}</b> ${r.device} ${r.viewport} - ${r.locale}/${r.theme}<br>${r.state.slice(0, 70)}</figcaption></figure>`,
  )
  .join("\n");
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#f2e9d8;font:12px system-ui,sans-serif;color:#071a2d}
h1{font-size:16px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
figure{margin:0;background:#fff;border:1px solid #d8c7a6;border-radius:6px;padding:6px}
.img{height:150px;overflow:hidden;background:#eee;display:flex;align-items:flex-start;justify-content:center}
img{max-width:100%;max-height:none;width:100%;object-fit:cover;object-position:top}
figcaption{margin-top:4px;line-height:1.3}
</style><h1>M4 review pack - ${rows.length} real screenshots (top of each page; full images in the folder)</h1><div class="grid">${cells}</div>`;
const htmlPath = path.join(OUT, "_contact-sheet.html");
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
const bad = await page.evaluate(() => Array.from(document.images).filter((i) => i.naturalWidth === 0).map((i) => i.src));
if (bad.length) throw new Error("images that do not decode: " + bad.join(", "));
const dims = await page.evaluate(() => Array.from(document.images).map((i) => [i.src.split("/").pop(), i.naturalWidth, i.naturalHeight]));
await page.screenshot({ path: path.join(OUT, "contact-sheet.png"), fullPage: true });
await browser.close();
import("node:fs").then((fs) => fs.unlinkSync(htmlPath));
console.log("verified", dims.length, "images decode; contact sheet written");
