import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  taken: vi.fn(),
  rekey: vi.fn(),
  limit: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: s.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: s.rpc, auth: { getUser: s.getUser } }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: s.signIn, signOut: s.signOut } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://x.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }) }));
vi.mock("@/lib/supabase/admin-server", () => ({ isCanonicalPhoneTaken: s.taken, rekeyLoginAlias: s.rekey }));
vi.mock("@/server/auth/phone-auth-limit", () => ({ phoneAuthLimit: s.limit }));

import { changeLoginPhoneAction } from "./profile-identity";

const OLD_ALIAS = "p201055500101@craftsman-login.aladdin.invalid";
const NEW_ALIAS = "p201055500202@craftsman-login.aladdin.invalid";
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ countryIso2: "EG", national: "1055500202", e164: "+201055500202", currentPassword: "test-password-not-real", ...over })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  s.getUser.mockResolvedValue({ data: { user: { id: "u1", email: OLD_ALIAS } } });
  s.limit.mockResolvedValue("allowed");
  s.signIn.mockResolvedValue({ error: null });
  s.signOut.mockResolvedValue({ error: null });
  s.taken.mockResolvedValue(false);
  s.rekey.mockResolvedValue({ ok: true });
  s.rpc.mockResolvedValue({ error: null });
});

describe("changeLoginPhoneAction (phone + password accounts)", () => {
  it("proves the password, moves the alias, then the profile phone, and refreshes the header", async () => {
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: true });
    expect(s.signIn).toHaveBeenCalledWith({ email: OLD_ALIAS, password: "test-password-not-real" });
    expect(s.rekey).toHaveBeenCalledWith("u1", NEW_ALIAS);
    expect(s.rpc).toHaveBeenCalledWith("profile_set_phone", { p_country_iso2: "EG", p_national: "1055500202", p_e164: "+201055500202" });
    expect(s.rekey.mock.invocationCallOrder[0]).toBeLessThan(s.rpc.mock.invocationCallOrder[0]!);
    expect(s.revalidate).toHaveBeenCalledWith("/home", "layout");
  });

  it("changes nothing with a wrong password", async () => {
    s.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.wrongPassword" });
    expect(s.rekey).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("asks for the password before anything else", async () => {
    expect(await changeLoginPhoneAction({ ok: false }, form({ currentPassword: "" }))).toEqual({ ok: false, code: "profileIdentity.phone.passwordRequired" });
    expect(s.signIn).not.toHaveBeenCalled();
  });

  it("is throttled like a sign-in", async () => {
    s.limit.mockResolvedValue("limited");
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.rateLimited" });
    expect(s.signIn).not.toHaveBeenCalled();
  });

  it("refuses a number another account already holds, without touching the alias", async () => {
    s.taken.mockResolvedValue(true);
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.unavailable" });
    expect(s.rekey).not.toHaveBeenCalled();
  });

  it("puts the old login alias back when the profile write fails", async () => {
    s.rpc.mockResolvedValue({ error: { code: "23505", message: "unavailable" } });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.unavailable" });
    expect(s.rekey).toHaveBeenNthCalledWith(1, "u1", NEW_ALIAS);
    expect(s.rekey).toHaveBeenNthCalledWith(2, "u1", OLD_ALIAS);
  });

  it("treats the same number as a no-op", async () => {
    expect(await changeLoginPhoneAction({ ok: false }, form({ e164: "+201055500101", national: "1055500101" }))).toEqual({ ok: true });
    expect(s.rekey).not.toHaveBeenCalled();
    expect(s.signIn).not.toHaveBeenCalled();
  });

  it("is not available to an account that signs in with e-mail", async () => {
    s.getUser.mockResolvedValue({ data: { user: { id: "u2", email: "karim@example.test" } } });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.error" });
    expect(s.rekey).not.toHaveBeenCalled();
  });
});
