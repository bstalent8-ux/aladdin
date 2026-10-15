import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), update: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { admin: { createUser: mocks.create, deleteUser: mocks.remove, updateUserById: mocks.update } } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:63321" }), parseServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "local-test-only" }) }));
import { createShowroomPasswordUser, createCraftsmanPasswordUser, deleteCraftsmanPasswordUser, PASSWORD_SET_FLAG } from "./admin-server";
const params = { loginAlias: "p201012345678@craftsman-login.aladdin.invalid", password: "  valid local password  ", fullName: "Local Test" };
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ data: { user: { id: "fresh-user" } }, error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.update.mockResolvedValue({ error: null }); });
describe("trusted phone identity creation", () => {
  it.each([[createShowroomPasswordUser, "temporary_showroom_password_flow"], [createCraftsmanPasswordUser, "temporary_craftsman_password_flow"]] as const)("sets only audit source/password state and confirms only the INTERNAL alias", async (create, source) => {
    expect(await create(params)).toEqual({ ok: true, userId: "fresh-user" });
    expect(mocks.create).toHaveBeenCalledWith({ email: params.loginAlias, password: params.password, email_confirm: true, user_metadata: { full_name: params.fullName, locale: "ar" }, app_metadata: { registration_source: source, [PASSWORD_SET_FLAG]: true } });
    expect(mocks.create.mock.lastCall![0]).not.toHaveProperty("phone_confirm");
    expect(mocks.create.mock.lastCall![0]).not.toHaveProperty("role");
  });
  it("does not ban when compensation succeeds", async () => { expect(await deleteCraftsmanPasswordUser("fresh-user")).toBe(true); expect(mocks.update).not.toHaveBeenCalled(); });
  it("quarantines only the newly created identity if compensation fails", async () => { mocks.remove.mockResolvedValue({ error: { code: "unexpected_failure" } }); expect(await deleteCraftsmanPasswordUser("fresh-user")).toBe(false); expect(mocks.update).toHaveBeenCalledWith("fresh-user", { ban_duration: "876000h" }); });
});
