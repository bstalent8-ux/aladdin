import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw Error("REDIRECT:" + url); }) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })), cookies: vi.fn(async () => ({ get: () => undefined })) }));
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), landing: vi.fn(), requestSignUp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut }, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin-server", () => ({}));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: mocks.landing }));
vi.mock("@/server/actions/auth-password-preview", () => ({ requestPasswordSignUp: mocks.requestSignUp }));

import { entryEmailSignIn, entryEmailSignUp } from "./entry-email";

function form(patch: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ email: "owner@example.test", password: "old pwd", captchaToken: "tok", ...patch })) data.set(key, value);
  return data;
}
async function run(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.landing.mockResolvedValue("/b2b");
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "account_entry_allowed" ? true : name === "my_registration_state" ? "access_ready" : null, error: null }));
  mocks.requestSignUp.mockResolvedValue({ ok: true, code: "authPasswordPreview.info.codeSent", email: "owner@example.test" });
});

describe("email sign-in on the entry pages", () => {
  it("signs in with email + password and checks the account type for the page", async () => {
    expect(await run(() => entryEmailSignIn("showroom", { ok: false }, form({ next: "/b2b/products" })))).toBe("REDIRECT:/b2b/products");
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "owner@example.test", password: "old pwd", options: { captchaToken: "tok" } });
    expect(mocks.rpc).toHaveBeenCalledWith("account_entry_allowed", { p_kind: "showroom" });
  });

  it.each(["showroom", "installer"] as const)("keeps another account type out of the %s pages and clears the session", async (kind) => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await entryEmailSignIn(kind, { ok: false }, form());
    expect(result.code).toBe(kind === "showroom" ? "entryAuth.error.notShowroomAccount" : "entryAuth.error.notInstallerAccount");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.landing).not.toHaveBeenCalled();
  });

  it("fails closed when the account check errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect((await entryEmailSignIn("installer", { ok: false }, form())).ok).toBe(false);
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it.each(["invalid_credentials", "email_not_confirmed", "user_banned"])("returns one generic message for %s", async (code) => {
    mocks.signIn.mockResolvedValue({ error: { code } });
    expect((await entryEmailSignIn("installer", { ok: false }, form())).code).toBe("entryAuth.error.invalidCredentials");
  });

  it("rejects bad input and a missing challenge before calling Supabase", async () => {
    expect((await entryEmailSignIn("showroom", { ok: false }, form({ email: "nope" }))).field).toBe("email");
    expect((await entryEmailSignIn("showroom", { ok: false }, form({ password: "" }))).field).toBe("password");
    expect((await entryEmailSignIn("showroom", { ok: false }, form({ captchaToken: "" }))).field).toBe("captcha");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("maps rate limits and CAPTCHA refusals", async () => {
    mocks.signIn.mockResolvedValueOnce({ error: { status: 429 } });
    expect((await entryEmailSignIn("showroom", { ok: false }, form())).code).toBe("temporaryCraftsman.error.rateLimited");
    mocks.signIn.mockResolvedValueOnce({ error: { code: "captcha_failed" } });
    expect((await entryEmailSignIn("showroom", { ok: false }, form())).field).toBe("captcha");
  });

  it("never echoes the password or internal errors", async () => {
    mocks.signIn.mockRejectedValue(Error("private-detail"));
    const result = await entryEmailSignIn("showroom", { ok: false }, form({ password: "secret-value" }));
    expect(JSON.stringify(result)).not.toContain("private-detail");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});

describe("email sign-up on the entry pages", () => {
  it.each([
    ["showroom", "showroom_dealer", /^showroom\.[a-z0-9]{8}$/],
    ["installer", "installer_technician", /^craftsman\.[a-z0-9]{8}$/],
  ] as const)("hands %s registration to the canonical email + OTP sign-up with a fixed account type", async (kind, accountType, username) => {
    const result = await entryEmailSignUp(kind, { ok: false }, form({ name: "أحمد محمد", password: "green-tiles-on-roof", confirmPassword: "green-tiles-on-roof", consent: "on", accountType: "admin" }));
    expect(result.ok).toBe(true);
    const sent = mocks.requestSignUp.mock.calls[0]![1] as FormData;
    expect(sent.get("accountType")).toBe(accountType);
    expect(String(sent.get("username"))).toMatch(username);
    expect(sent.get("displayName")).toBe("أحمد محمد");
    expect(sent.get("email")).toBe("owner@example.test");
    expect(sent.get("confirmPassword")).toBe("green-tiles-on-roof");
    expect(["terms", "privacy", "pilot"].map((type) => sent.get(`consent_${type}`))).toEqual(["on", "on", "on"]);
    expect(sent.get("captchaToken")).toBe("tok");
  });

  it("passes a missing consent through as missing", async () => {
    await entryEmailSignUp("showroom", { ok: false }, form());
    const sent = mocks.requestSignUp.mock.calls[0]![1] as FormData;
    expect(sent.get("consent_terms")).toBe("");
  });
});
