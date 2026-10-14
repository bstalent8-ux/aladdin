import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw Error("REDIRECT:" + url); }) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), create: vi.fn(), taken: vi.fn(), remove: vi.fn(), limit: vi.fn(), captcha: vi.fn(), landing: vi.fn(), getClient: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: mocks.getClient }));
vi.mock("@/lib/supabase/admin-server", () => ({ createShowroomPasswordUser: mocks.create, createCraftsmanPasswordUser: mocks.create, isCanonicalPhoneTaken: mocks.taken, deleteCraftsmanPasswordUser: mocks.remove }));
vi.mock("@/server/auth/phone-auth-limit", () => ({ phoneAuthLimit: mocks.limit }));
vi.mock("@/server/auth/turnstile", () => ({ verifyTurnstileToken: mocks.captcha, clientIpFrom: () => null, turnstileHostnamesFrom: () => ["app.example.test"] }));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: mocks.landing }));
import { showroomSignUp, showroomSignIn } from "./showroom-phone-auth";
const password = "  green-tiles-on-roof  ";
function form(patch: Record<string, string> = {}) { const data = new FormData(); for (const [key, value] of Object.entries({ name: "أحمد محمد", phone: "01093817264", country: "EG", password, confirmPassword: password, consent: "on", captchaToken: "tok", captchaSessionToken: "tok-session", ...patch }))
    data.set(key, value); return data; }
const client = { auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut, getUser: mocks.getUser }, rpc: mocks.rpc };
async function run(fn: () => Promise<unknown>) { try {
    return await fn();
}
catch (e) {
    return (e as Error).message;
} }
beforeEach(() => { vi.clearAllMocks(); mocks.getClient.mockResolvedValue(client); mocks.getUser.mockResolvedValue({ data: { user: null }, error: null }); mocks.signIn.mockResolvedValue({ error: null }); mocks.signOut.mockResolvedValue({ error: null }); mocks.create.mockResolvedValue({ ok: true, userId: "fresh-user" }); mocks.taken.mockResolvedValue(false); mocks.remove.mockResolvedValue(true); mocks.limit.mockResolvedValue("allowed"); mocks.captcha.mockResolvedValue({ ok: true }); mocks.landing.mockResolvedValue("/onboarding/business"); mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "phone_password_account_allowed" ? true : name === "my_registration_state" ? "access_ready" : null, error: null })); });
describe("showroom registration", () => {
    it("records showroom INTENT without granting a role, membership or approval", async () => {
        expect(await run(() => showroomSignUp({ ok: false }, form({ role: "admin", approved: "true" })))).toBe("REDIRECT:/onboarding/business");
        expect(mocks.create).toHaveBeenCalledWith({ loginAlias: "p201093817264@craftsman-login.aladdin.invalid", password, fullName: "أحمد محمد" });
        expect(mocks.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "business", p_account_type: "showroom_dealer" });
        expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["record_consent", "onboarding_select_account_type", "profile_set_phone", "profile_set_username", "my_registration_state"]);
    });
    it.each([[{ name: "" }, "name"], [{ phone: "01912345678" }, "phone"], [{ country: "ZZ" }, "phone"], [{ password: "short" }, "password"], [{ password: "password123" }, "password"], [{ password: "ب".repeat(37) }, "password"], [{ confirmPassword: "wrong" }, "confirmPassword"], [{ consent: "" }, "consent"]])("rejects invalid input before provider calls", async (patch, field) => { const result = await showroomSignUp({ ok: false }, form(patch)); expect(result.field).toBe(field); expect(mocks.create).not.toHaveBeenCalled(); });
    it("rejects huge payloads before echo, rate limit or provider calls", async () => { expect(await showroomSignUp({ ok: false }, form({ password: "x".repeat(1000000) }))).toEqual({ ok: false, field: "form", code: "temporaryCraftsman.error.requestTooLarge" }); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); });
    it("rejects duplicate phone claims globally", async () => { mocks.taken.mockResolvedValue(true); expect((await showroomSignUp({ ok: false }, form())).code).toBe("temporaryCraftsman.error.phoneExists"); expect(mocks.create).not.toHaveBeenCalled(); });
    it.each(["record_consent", "onboarding_select_account_type", "profile_set_phone", "profile_set_username", "my_registration_state"])("revokes session and rolls back a failed %s", async (step) => { mocks.rpc.mockImplementation(async (name: string) => ({ data: "access_ready", error: name === step ? { code: "XX000" } : null })); expect((await showroomSignUp({ ok: false }, form())).ok).toBe(false); expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" }); expect(mocks.remove).toHaveBeenCalledWith("fresh-user"); });
    it("does not create an identity when cookie-client setup fails", async () => { mocks.getClient.mockRejectedValue(Error("private-token")); const result = await showroomSignUp({ ok: false }, form()); expect(result.code).toBe("temporaryCraftsman.error.signUpFailed"); expect(mocks.create).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("private-token"); });
    it("handles a concurrent phone claim and cleans only this newly created user", async () => { mocks.rpc.mockImplementation(async (name: string) => ({ data: null, error: name === "profile_set_phone" ? { code: "23505" } : null })); expect((await showroomSignUp({ ok: false }, form())).code).toBe("temporaryCraftsman.error.phoneExists"); expect(mocks.remove).toHaveBeenCalledWith("fresh-user"); });
    it("rejects CAPTCHA before creating an account", async () => { mocks.captcha.mockResolvedValue({ ok: false, reason: "rejected" }); expect((await showroomSignUp({ ok: false }, form())).field).toBe("captcha"); expect(mocks.create).not.toHaveBeenCalled(); });
    it.each(["limited", "unavailable"])("fails closed on %s throttle", async (verdict) => { mocks.limit.mockResolvedValue(verdict); expect((await showroomSignUp({ ok: false }, form())).ok).toBe(false); expect(mocks.create).not.toHaveBeenCalled(); });
});
describe("showroom login", () => {
    it("establishes the normal session and resumes mandatory onboarding", async () => { expect(await run(() => showroomSignIn({ ok: false }, form()))).toBe("REDIRECT:/onboarding/business"); expect(mocks.rpc).toHaveBeenCalledWith("phone_password_account_allowed", { p_kind: "showroom", p_phone: "+201093817264" }); });
    it.each(["invalid_credentials", "user_banned", "email_not_confirmed"])("returns generic credential errors: %s", async (code) => { mocks.signIn.mockResolvedValue({ error: { code } }); expect((await showroomSignIn({ ok: false }, form())).code).toBe("temporaryCraftsman.error.invalidCredentials"); });
    it("preserves an existing short password unchanged", async () => { await run(() => showroomSignIn({ ok: false }, form({ password: "old pwd" }))); expect(mocks.signIn).toHaveBeenCalledWith({ email: "p201093817264@craftsman-login.aladdin.invalid", password: "old pwd", options: { captchaToken: "tok" } }); });
    it("denies cross-account entry and clears its session", async () => { mocks.rpc.mockResolvedValue({ data: false, error: null }); expect((await showroomSignIn({ ok: false }, form())).code).toBe("temporaryCraftsman.error.invalidCredentials"); expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(mocks.landing).not.toHaveBeenCalled(); });
    it.each(["x".repeat(73), "ب".repeat(37), "x".repeat(1000000)])("rejects unsupported size before authentication", async (value) => { expect((await showroomSignIn({ ok: false }, form({ password: value }))).ok).toBe(false); expect(mocks.signIn).not.toHaveBeenCalled(); });
    it("handles provider 429", async () => { mocks.signIn.mockResolvedValue({ error: { status: 429 } }); expect((await showroomSignIn({ ok: false }, form())).code).toBe("temporaryCraftsman.error.rateLimited"); });
    it("blocks throttled attempts before checking credentials", async () => { mocks.limit.mockResolvedValue("limited"); expect((await showroomSignIn({ ok: false }, form())).code).toBe("temporaryCraftsman.error.rateLimited"); expect(mocks.signIn).not.toHaveBeenCalled(); });
    it("does not expose internal errors", async () => { mocks.signIn.mockRejectedValue(Error("private-password")); const result = await showroomSignIn({ ok: false }, form()); expect(JSON.stringify(result)).not.toContain("private-password"); });
    it("preserves only the caller's own surface deep link", async () => { mocks.landing.mockResolvedValue("/b2b"); expect(await run(() => showroomSignIn({ ok: false }, form({ next: "/admin/users" })))).toBe("REDIRECT:/b2b"); expect(await run(() => showroomSignIn({ ok: false }, form({ next: "/b2b/products" })))).toBe("REDIRECT:/b2b/products"); });
});

it("does not create or overwrite an existing signed-in identity from a direct action invocation", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: "existing-user" } }, error: null }); expect(await run(() => showroomSignUp({ ok: false }, form()))).toBe("REDIRECT:/onboarding"); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.signIn).not.toHaveBeenCalled(); });

describe("CAPTCHA tokens (A: verified by Aladdin, B: forwarded to GoTrue)", () => {
    const ALIAS = "p201093817264@craftsman-login.aladdin.invalid";
    it("verifies token A once, with the expected action and hostnames, and never sends token B to Siteverify", async () => {
        await run(() => showroomSignUp({ ok: false }, form({ captchaToken: "token-a", captchaSessionToken: "token-b" })));
        expect(mocks.captcha).toHaveBeenCalledTimes(1);
        expect(mocks.captcha).toHaveBeenCalledWith("token-a", expect.objectContaining({ expectedAction: "phone-sign-up", expectedHostnames: ["app.example.test"] }));
        expect(mocks.captcha.mock.calls.flat().filter((arg) => arg === "token-b")).toHaveLength(0);
    });
    it("forwards token B to GoTrue for the sign-in that follows account creation", async () => {
        await run(() => showroomSignUp({ ok: false }, form({ captchaToken: "token-a", captchaSessionToken: "token-b" })));
        expect(mocks.signIn).toHaveBeenCalledWith({ email: ALIAS, password, options: { captchaToken: "token-b" } });
    });
    it("refuses a sign-up without token B BEFORE verifying token A or creating anything", async () => {
        const result = await showroomSignUp({ ok: false }, form({ captchaSessionToken: "" }));
        expect(result).toMatchObject({ ok: false, field: "captcha", code: "temporaryCraftsman.error.captchaRequired" });
        expect(mocks.captcha).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it("rolls back and asks to verify again - never shows success - when GoTrue rejects token B", async () => {
        mocks.signIn.mockResolvedValue({ error: { code: "captcha_failed", message: "captcha protection: request disallowed (timeout-or-duplicate)" } });
        const result = await run(() => showroomSignUp({ ok: false }, form()));
        expect(result).toMatchObject({ ok: false, field: "captcha", code: "temporaryCraftsman.error.signInVerificationRetry" });
        expect(mocks.remove).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("requires a token for sign-in and forwards it to GoTrue", async () => {
        expect(await showroomSignIn({ ok: false }, form({ captchaToken: "" }))).toMatchObject({ ok: false, field: "captcha", code: "temporaryCraftsman.error.captchaRequired" });
        expect(mocks.signIn).not.toHaveBeenCalled();
        await run(() => showroomSignIn({ ok: false }, form({ captchaToken: "signin-token" })));
        expect(mocks.signIn).toHaveBeenCalledWith({ email: ALIAS, password, options: { captchaToken: "signin-token" } });
    });
    it("reports a GoTrue-rejected sign-in token as a CAPTCHA error, not as wrong credentials", async () => {
        mocks.signIn.mockResolvedValue({ error: { code: "captcha_failed" } });
        expect(await showroomSignIn({ ok: false }, form())).toMatchObject({ ok: false, field: "captcha", code: "temporaryCraftsman.error.captchaRejected" });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
});
