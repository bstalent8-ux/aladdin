import { beforeEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ consume: vi.fn(), environment: vi.fn() }));
vi.mock("@/lib/supabase/admin-server", () => ({ consumePhoneAuthLimit: mocks.consume }));
vi.mock("@/lib/env", () => ({ readAuthIdentifierSecret: () => "test-secret-with-more-than-32-characters", readPublicEnv: mocks.environment }));
import { phoneAuthLimit } from "./phone-auth-limit";
beforeEach(() => { mocks.consume.mockResolvedValue(true); mocks.environment.mockReturnValue({ NEXT_PUBLIC_APP_ENV: "production" }); });
it("stores HMAC identifiers instead of phone or IP, ignores forged client XFF", async () => { const headers = { get: (name: string) => name === "x-forwarded-for" ? "1.2.3.4" : name === "x-vercel-forwarded-for" ? "8.8.8.8" : null }; expect(await phoneAuthLimit("sign-in", "+201012345678", headers)).toBe("allowed"); const [, ip, phone] = mocks.consume.mock.lastCall!; expect(ip).toMatch(/^[a-f0-9]{64}$/); expect(phone).toMatch(/^[a-f0-9]{64}$/); expect(phone).not.toContain("201012345678"); await phoneAuthLimit("sign-in", "+201012345678", { get: name => name === "x-vercel-forwarded-for" ? "8.8.8.8" : "9.9.9.9" }); expect(mocks.consume.mock.lastCall![1]).toBe(ip); });
it("surfaces a limit and fails closed on storage failure", async () => { mocks.consume.mockResolvedValue(false); expect(await phoneAuthLimit("sign-up", "+201012345678", { get: () => null })).toBe("limited"); mocks.consume.mockRejectedValue(Error("secret failure")); expect(await phoneAuthLimit("sign-in", "+201012345678", { get: () => null })).toBe("unavailable"); });
