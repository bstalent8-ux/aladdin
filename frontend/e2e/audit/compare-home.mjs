// Builds the side-by-side comparison of the approved Home reference and the current Home (Arabic, light, 1440).
// Run from frontend/: node e2e/audit/compare-home.mjs
import { chromium } from "@playwright/test";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const docs = path.resolve(process.cwd(), "..", "docs", "frontend");
const ref = path.join(docs, "references", "showroom-suite-v2", "showroom-home-reference-v2.png");
const impl = path.join(docs, "screenshots", "v2-reference-alignment", "v2-release", "r01-home.ar.light.1440x900.png");
const out = path.join(docs, "screenshots", "v2-reference-alignment", "compare-home-ar-light.png");
for (const f of [ref, impl]) if (!existsSync(f)) throw new Error("missing " + f);
const html = path.join(path.dirname(out), "_compare.html");
writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#222;color:#fff;font:14px system-ui}
.row{display:flex;gap:16px;padding:16px;align-items:flex-start}
figure{margin:0;flex:1 1 0;min-width:0}figcaption{margin:0 0 8px;font-weight:600}
img{width:100%;display:block;background:#fff}
</style><div class="row"><figure><figcaption>Approved reference</figcaption><img src="${pathToFileURL(ref).href}"></figure>
<figure><figcaption>Implementation (real data, AR, light, 1440)</figcaption><img src="${pathToFileURL(impl).href}"></figure></div>`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2960, height: 1000 } });
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
unlinkSync(html);
console.log("written", out);
