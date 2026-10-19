import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CreateBucketCommand, ListObjectsV2Command, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { E2E_PASSWORD } from "../helpers/auth";
import { startLocalEdge, type LocalEdge } from "../helpers/local-media-edge";

/**
 * Video on the isolated local stack (playwright.video.config.ts), desktop and mobile:
 *
 *   upload (browser -> S3 stand-in, multipart, progress) -> transcode (Python worker,
 *   ffmpeg, HLS) -> owner playback and seeking through the real media Worker handler
 *   -> publish -> anonymous playback on the public profile -> unpublish revokes the
 *   very next segment -> sign-out revokes the owner's play ticket -> delete revokes ->
 *   purge removes every object.
 *
 * It also asserts that no video byte goes through the app: the browser sends parts to
 * storage and fetches playlists and segments from the edge origin only.
 */
const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} missing`); return v; };
const OWNER_EMAIL = "amr@example.test";
const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';
const SHOTS = process.env.VIDEO_E2E_SHOTS ?? "/mnt/project-files/showroom-admin/e2e/video";

test.describe.configure({ mode: "serial" });

let edge: LocalEdge;
let s3: S3Client;
let role: string;
let workdir: string;
let sample: string;
const appOrigin = "http://127.0.0.1:3200";
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";

/** One value from the LOCAL database (psql inside the local Supabase container). */
function scalar(query: string): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query])
    .toString().trim();
}
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

function backend(args: string[]): Record<string, unknown> {
  const out = execFileSync("uv", ["run", "--group", "video-worker", "python", "-m", "app.workers.video_transcode", ...args], {
    cwd: path.resolve(__dirname, "../../../backend"), encoding: "utf8", timeout: 200_000,
    env: { ...process.env, APP_ENV: "local", SUPABASE_URL: env("E2E_API_URL"), SUPABASE_SERVICE_ROLE_KEY: env("E2E_SERVICE_ROLE_KEY"),
      R2_ACCESS_KEY_ID: env("E2E_S3_ACCESS_KEY"), R2_SECRET_ACCESS_KEY: env("E2E_S3_SECRET_KEY"),
      R2_PRIVATE_BUCKET: env("E2E_S3_BUCKET"), R2_LOCAL_S3_ENDPOINT: env("E2E_S3_ENDPOINT"), REDIS_URL: "" },
  });
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

async function objects(prefix: string): Promise<string[]> {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: env("E2E_S3_BUCKET"), Prefix: prefix }));
  return (out.Contents ?? []).map((o) => o.Key!);
}

async function context(browser: Browser, info: TestInfo) {
  const { defaultBrowserType: _ignored, ...device } = info.project.use;
  const ctx = await browser.newContext({ ...device, baseURL: appOrigin, ignoreHTTPSErrors: true });
  await ctx.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }));
  return ctx;
}

async function signIn(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$/i).fill(OWNER_EMAIL);
  await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { waitUntil: "commit", timeout: 30_000 });
}

/** Plays from the poster, then seeks; returns the segment URLs the player fetched. */
async function playAndSeek(page: Page, root: ReturnType<Page["locator"]>) {
  const segments: string[] = [];
  page.on("response", (r) => { if (/\.m4s(\?|$)/.test(r.url())) segments.push(`${r.status()} ${r.url()}`); });
  await root.getByRole("button", { name: /^play /i }).click();
  const video = root.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 6; });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (!v.seeking && v.currentTime >= 6 ? v.currentTime : 0)),
    { timeout: 30_000 }).toBeGreaterThan(6);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  return segments;
}

test.beforeAll(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), "video-e2e-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", `${workdir}/key.pem`, "-out", `${workdir}/cert.pem`], { stdio: "ignore" });
  sample = `${workdir}/sample.mp4`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", "-movflags", "+faststart", sample]);

  role = `media_edge_e2e_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(18).toString("base64url");
  scalar(`create role ${role} login password '${password}' in role media_edge`);
  const db = new URL(env("E2E_DB_URL")); db.username = role; db.password = password;

  s3 = new S3Client({ endpoint: env("E2E_S3_ENDPOINT"), region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: env("E2E_S3_ACCESS_KEY"), secretAccessKey: env("E2E_S3_SECRET_KEY") } });
  await s3.send(new CreateBucketCommand({ Bucket: env("E2E_S3_BUCKET") })).catch(() => undefined);
  // The same rule production needs on the R2 bucket: browsers may PUT parts from the app origin.
  await s3.send(new PutBucketCorsCommand({ Bucket: env("E2E_S3_BUCKET"), CORSConfiguration: { CORSRules: [
    { AllowedOrigins: [appOrigin], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type", "content-length"], MaxAgeSeconds: 600 }] } }));

  edge = await startLocalEdge({ port: Number(env("E2E_EDGE_PORT")),
    tls: { key: readFileSync(`${workdir}/key.pem`, "utf8"), cert: readFileSync(`${workdir}/cert.pem`, "utf8") },
    s3, bucket: env("E2E_S3_BUCKET"), databaseUrl: db.toString(), ticketKeys: { e2e: env("E2E_TICKET_SECRET") }, allowedOrigins: [appOrigin] });
});

test.afterAll(async () => {
  await edge?.close();
  if (role) scalar(`drop role if exists ${role}`);
});

test("portfolio video: upload, transcode, play, seek, publish, revoke, delete, purge", async ({ browser }, info) => {
  const shot = (name: string) => `${SHOTS}/${info.project.name}-${name}.png`;
  const owner = await context(browser, info);
  const page = await owner.newPage();
  const appRequests: string[] = [];
  const storagePuts: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(appOrigin)) appRequests.push(r.url());
    if (r.url().startsWith(env("E2E_S3_ENDPOINT")) && r.method() === "PUT") storagePuts.push(r.url());
  });
  await signIn(page);
  const profileId = scalar(`select p.id from public.profiles p join auth.users u on u.id = p.user_id where u.email = ${lit(OWNER_EMAIL)}`);

  // 1. Upload: bytes go to storage in parts, with progress.
  await page.goto("/home/profile/portfolio");
  const manager = page.getByTestId("video-manager");
  await expect(manager).toBeVisible();
  const title = `E2E ${info.project.name} ${randomBytes(3).toString("hex")}`;
  await manager.locator("#video-file").setInputFiles(sample);
  await manager.locator("#video-title").fill(title);
  await manager.getByRole("button", { name: "Upload video" }).click();
  const card = manager.locator("li").filter({ hasText: title });
  await expect(card.getByTestId("video-state")).toContainText(/preparing the video/i, { timeout: 60_000 });
  expect(storagePuts.length).toBeGreaterThan(0);
  expect(storagePuts.every((u) => /partNumber=\d+&uploadId=/.test(u) || /uploadId=.*partNumber=/.test(u))).toBe(true);
  const videoId = scalar(`select id from public.media_videos where title = ${lit(title)}`);
  expect(await objects(`video/${videoId}/original`)).toEqual([`video/${videoId}/original`]);
  expect(scalar(`select size_bytes from public.media_videos where id = ${lit(videoId)}`)).toBe(String(statSync(sample).size));

  // 2. Transcode.
  const started = Date.now();
  const result = backend(["--once"]);
  expect(result).toMatchObject({ video_id: videoId, outcome: "ready" });
  info.annotations.push({ type: "transcode-ms", description: String(Date.now() - started) });
  const [revision, renditions] = scalar(`select revision || '|' || array_to_string(renditions, ',') from public.media_videos where id = ${lit(videoId)}`).split("|");
  expect(renditions).toBe("360p,720p");
  expect(await objects(`video/${videoId}/${revision}/`)).toContain(`video/${videoId}/${revision}/master.m3u8`);

  // 3. Owner playback and seeking, from the edge only.
  await page.reload();
  const player = card.getByTestId("video-player");
  await expect(player).toBeVisible();
  await expect(player.locator("video")).toHaveAttribute("poster", new RegExp(`^${edge.origin}/v/${videoId}/poster\\.jpg\\?t=`));
  const ownerSegments = await playAndSeek(page, player);
  expect(ownerSegments.length).toBeGreaterThan(0);
  expect(ownerSegments.every((s) => s.startsWith("200 ") && s.includes(`${edge.origin}/v/${videoId}/`) && s.includes("?t="))).toBe(true);
  await page.screenshot({ path: shot("owner-playing"), fullPage: false });
  const ownerSegment = ownerSegments.at(-1)!.slice(4);

  // Range on a segment.
  const ranged = await page.request.get(ownerSegment, { headers: { range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);

  // 4. Publish; anonymous viewer on the public profile.
  await card.getByRole("button", { name: "Publish" }).click();
  await expect(card).toContainText("Published");
  const anon = await context(browser, info);
  const visitor = await anon.newPage();
  await visitor.goto(`/p/${profileId}`);
  const publicPlayer = visitor.getByTestId("video-player").filter({ has: visitor.locator(`video[aria-label="${title}"]`) });
  await expect(publicPlayer).toBeVisible();
  const publicSegments = await playAndSeek(visitor, publicPlayer);
  expect(publicSegments.every((s) => s.startsWith("200 ") && !s.includes("?t="))).toBe(true);
  await visitor.screenshot({ path: shot("public-playing"), fullPage: false });
  const publicSegment = publicSegments.at(-1)!.slice(4);

  // 5. Unpublish: the next anonymous segment request is refused, the owner's still plays.
  await card.getByRole("button", { name: "Unpublish" }).click();
  await expect(card).toContainText("Private");
  expect((await visitor.request.get(publicSegment)).status()).toBe(404);
  expect((await page.request.get(ownerSegment)).status()).toBe(200);
  await visitor.reload();
  await expect(visitor.locator(`video[aria-label="${title}"]`)).toHaveCount(0);

  // 6. No video byte went through the app.
  expect(appRequests.filter((u) => /\.(m4s|m3u8)|\/v\/|video\/.*original/.test(new URL(u).pathname))).toEqual([]);

  // 7. Delete revokes immediately; purge removes every object.
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card.getByRole("button", { name: "Delete video" }).click();
  await expect(manager.locator("li").filter({ hasText: title })).toHaveCount(0);
  expect((await page.request.get(ownerSegment)).status()).toBe(404);
  expect(backend(["--purge"])).toMatchObject({ purged: expect.any(Number) });
  expect(await objects(`video/${videoId}/`)).toEqual([]);
  expect(scalar(`select purged_at is not null from public.media_videos where id = ${lit(videoId)}`)).toBe("t");

  info.annotations.push({ type: "edge", description: JSON.stringify(edge.stats) });
  await anon.close();
  await owner.close();
});

test("sign-out revokes the owner's play ticket", async ({ browser }, info) => {
  const owner = await context(browser, info);
  const page = await owner.newPage();
  await signIn(page);
  await page.goto("/home/profile/portfolio");
  const manager = page.getByTestId("video-manager");
  const title = `E2E signout ${randomBytes(3).toString("hex")}`;
  await manager.locator("#video-file").setInputFiles(sample);
  await manager.locator("#video-title").fill(title);
  await manager.getByRole("button", { name: "Upload video" }).click();
  const card = manager.locator("li").filter({ hasText: title });
  await expect(card.getByTestId("video-state")).toBeVisible({ timeout: 60_000 });
  expect(backend(["--once"])).toMatchObject({ outcome: "ready" });
  await page.reload();
  const segments = await playAndSeek(page, card.getByTestId("video-player"));
  const segment = segments.at(-1)!.slice(4);
  expect((await page.request.get(segment)).status()).toBe(200);

  await page.getByTestId("profile-menu-trigger").filter({ visible: true }).first().click();
  await page.getByTestId("profile-sign-out").filter({ visible: true }).first().click();
  await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
  expect((await page.request.get(segment)).status()).toBe(404);

  // Clean up through the product path: sign in again, delete, purge.
  await signIn(page);
  await page.goto("/home/profile/portfolio");
  const again = page.getByTestId("video-manager").locator("li").filter({ hasText: title });
  await again.getByRole("button", { name: "Delete", exact: true }).click();
  await again.getByRole("button", { name: "Delete video" }).click();
  await expect(again).toHaveCount(0);
  backend(["--purge"]);
  await owner.close();
});
