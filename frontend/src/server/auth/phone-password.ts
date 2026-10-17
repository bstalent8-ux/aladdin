import "server-only";

import { loginPasswordSchema } from "@/features/auth-password-preview/password-policy";
import { authFormWithinLimit } from "@/lib/auth/form-limits";
import { phoneAuthLimit } from "@/server/auth/phone-auth-limit";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  createCraftsmanPasswordUser,
  createShowroomPasswordUser,
  deleteCraftsmanPasswordUser,
  isCanonicalPhoneTaken,
} from "@/lib/supabase/admin-server";
import { craftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { clientIpFrom, turnstileHostnamesFrom, verifyTurnstileToken } from "@/server/auth/turnstile";
import { CAPTCHA_SESSION_FIELD, captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import { hasAppAccess, type RegistrationState } from "@/server/queries/registration";
import { checkNewPassword, parseFullName, parsePhone } from "@/features/installer-phone-auth/validation";
import { generateCraftsmanUsername } from "@/features/installer-phone-auth/username";
import type { Database } from "@/types/database.types";

/**
 * Shared Installer/Showroom phone-password orchestration. Server wrappers select
 * the account type; the historical Craftsman alias and exported state names are
 * retained for compatibility. Reuse ordinary Supabase users, SSR sessions and
 * authenticated consent/onboarding/profile RPCs; registration grants intent only.
 * On initialization failure, sign out and delete the new identity. If deletion
 * fails, attempt quarantine; transport failure may require operator cleanup.
 * Application quotas supplement native provider limits but do not cover direct
 * GoTrue requests (documented draft blocker). Never log credentials or sessions.
 */

export type CraftsmanField = "name" | "phone" | "email" | "password" | "confirmPassword" | "consent" | "captcha" | "form";

export type CraftsmanAuthState = {
  ok: boolean;
  /** Translation key (temporaryCraftsman.*). */
  code?: string;
  /** Which field the message belongs to, for inline placement. */
  field?: CraftsmanField;
  /** Values echoed back so a failed submit does not clear the form. NEVER the password. */
  values?: { name?: string; phone?: string; email?: string };
};

const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const USERNAME_ATTEMPTS = 5;
type Client = SupabaseClient<Database>;

function fail(code: string, field: CraftsmanField, values?: CraftsmanAuthState["values"]): CraftsmanAuthState {
  return { ok: false, code: `temporaryCraftsman.error.${code}`, field, values };
}

function isRateLimited(error: { code?: string; status?: number }): boolean {
  return error.status === 429 || (error.code ?? "").startsWith("over_");
}

/** Safe diagnostics only: the step and a Postgres/GoTrue error code. */
function logStepFailure(step: string, error: { code?: string } | null | undefined): void {
  console.error(`phone password sign-up: ${step} failed (code ${error?.code ?? "unknown"})`);
}

class InitializationError extends Error {
  constructor(readonly outcome: "phone_taken" | "failed" | "captcha") {
    super(outcome);
  }
}

/**
 * Initializes the just-created account AS ITS OWN AUTHENTICATED CALLER through
 * the canonical RPCs. Throws `InitializationError` on the first failure.
 */
async function initializeCraftsmanAccount(
  supabase: Client,
  kind: "installer" | "showroom",
  phone: { countryIso2: string; national: string; e164: string },
): Promise<void> {
  const { error: consentError } = await supabase.rpc("record_consent", {
    p_types: [...CONSENT_TYPES],
    p_locale: "ar",
  });
  if (consentError) {
    logStepFailure("consent", consentError);
    throw new InitializationError("failed");
  }

  const { error: typeError } = await supabase.rpc("onboarding_select_account_type", {
    p_track: kind === "showroom" ? "business" : "professional",
    p_account_type: kind === "showroom" ? "showroom_dealer" : "installer_technician",
  });
  if (typeError) {
    logStepFailure("account_type", typeError);
    throw new InitializationError("failed");
  }

  // Authoritative phone claim — the unique index is the final word if another
  // account took this number after the pre-check (23505).
  const { error: phoneError } = await supabase.rpc("profile_set_phone", {
    p_country_iso2: phone.countryIso2,
    p_national: phone.national,
    p_e164: phone.e164,
  });
  if (phoneError) {
    if (phoneError.code === "23505") throw new InitializationError("phone_taken");
    logStepFailure("phone", phoneError);
    throw new InitializationError("failed");
  }

  if (!(await claimGeneratedUsername(supabase, kind))) throw new InitializationError("failed");

  const { data: state, error: stateError } = await supabase.rpc("my_registration_state");
  if (stateError || !hasAppAccess(state as RegistrationState)) {
    logStepFailure("registration_state", stateError ?? { code: String(state) });
    throw new InitializationError("failed");
  }
}

/** The internal username these entry pages generate (they never ask for one). */
export function generatedEntryUsername(kind: "installer" | "showroom"): string {
  return generateCraftsmanUsername().replace(/^craftsman/, kind === "showroom" ? "showroom" : "craftsman");
}

/**
 * Claims a generated username for the signed-in caller through the
 * authoritative `profile_set_username` RPC, retrying on a collision (23505).
 * False on any other failure or when every attempt collided.
 */
export async function claimGeneratedUsername(supabase: Client, kind: "installer" | "showroom"): Promise<boolean> {
  for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.rpc("profile_set_username", { p_username: generatedEntryUsername(kind) });
    if (!error) return true;
    if (error.code !== "23505") {
      logStepFailure("username", error);
      return false;
    }
  }
  logStepFailure("username", { code: "exhausted" });
  return false;
}

/**
 * Where a person who just got a session on a Showroom/Installer entry page
 * goes next — the SAME post-session rule as the shared email sign-in
 * (verifyEmailOtp): `next` is re-validated server-side (sanitizeNext:
 * same-origin allow-list, never `//host` or an absolute URL),
 * onboarding/invitation continuations keep their handoff, everything else
 * passes the registration gate, and a deep link survives only when it
 * belongs to the caller's own landing surface.
 */
export async function entryLandingPath(supabase: Client, rawNext: unknown): Promise<string> {
  const next = sanitizeNext(rawNext);
  if (next.startsWith("/onboarding") || next.startsWith("/auth/invite/")) return next;
  const { data: state } = await supabase.rpc("my_registration_state");
  if (!hasAppAccess(state as RegistrationState)) return "/onboarding";
  const landing = await resolveActiveLanding(supabase);
  return next === landing || next.startsWith(`${landing}/`) ? next : landing;
}

// ---------------------------------------------------------------------------
// Sign up — full name + phone + password + consent (+ Turnstile). No OTP.
// ---------------------------------------------------------------------------
export async function phonePasswordSignUp(kind: "installer" | "showroom", _prev: CraftsmanAuthState, formData: FormData): Promise<CraftsmanAuthState> {
  if (!authFormWithinLimit(formData)) return fail("requestTooLarge", "form");
  const rawName = typeof formData.get("name") === "string" ? String(formData.get("name")) : "";
  const rawPhone = typeof formData.get("phone") === "string" ? String(formData.get("phone")) : "";
  const values = { name: rawName, phone: rawPhone };

  const name = parseFullName(rawName);
  if (!name.ok) return { ok: false, code: name.code, field: "name", values };
  const phone = parsePhone(rawPhone, formData.get("country") ?? undefined);
  if (!phone.ok) return { ok: false, code: phone.code, field: "phone", values };
  const password = checkNewPassword(formData.get("password"), { phone: phone.value, name: name.value });
  if (!password.ok) return { ok: false, code: password.code, field: "password", values };
  if (kind === "showroom" && (formData.get("confirmPassword") !== password.value || !loginPasswordSchema.safeParse(formData.get("confirmPassword")).success)) {
    return fail("passwordMismatch", "confirmPassword", values);
  }
  if (formData.get("consent") !== "on") return fail("consentRequired", "consent", values);

  // Actions can be invoked from another route. Do not replace a signed-in
  // person's identity or create another account merely because the UI is hidden.
  let currentUser;
  let supabase: Client;
  try {
    supabase = await getServerSupabase();
    const current = await supabase.auth.getUser();
    if (current.error && !isAuthSessionMissingError(current.error)) return fail("signUpFailed", "form", values);
    currentUser = current.data.user;
  } catch { return fail("signUpFailed", "form", values); }
  if (currentUser) redirect("/onboarding");

  const h = await headers();
  const limited = await phoneAuthLimit("sign-up", phone.value.e164, h);
  if (limited !== "allowed") return fail(limited === "limited" ? "rateLimited" : "signUpFailed", "form", values);
  // TWO independent Turnstile tokens, each judged exactly once:
  //   Token A (`captchaToken`) - verified HERE via Siteverify, with hostname and
  //     action checks, because the account is created through the privileged
  //     Admin API, which GoTrue does not CAPTCHA-protect.
  //   Token B (`captchaSessionToken`) - forwarded to GoTrue for the password
  //     sign-in that follows, which GoTrue DOES protect. It is only checked for
  //     presence here, BEFORE any account exists, so a request without it never
  //     creates one.
  if (!captchaTokenFrom(formData, CAPTCHA_SESSION_FIELD)) return fail("captchaRequired", "captcha", values);
  const captcha = await verifyTurnstileToken(formData.get("captchaToken"), {
    remoteIp: clientIpFrom((headerName) => h.get(headerName)),
    expectedAction: "phone-sign-up",
    expectedHostnames: turnstileHostnamesFrom((headerName) => h.get(headerName)),
  });
  if (!captcha.ok) return fail(captcha.reason === "missing" ? "captchaRequired" : "captchaRejected", "captcha", values);
  const sessionCaptchaToken = captchaTokenFrom(formData, CAPTCHA_SESSION_FIELD) as string;

  // Duplicate phone — across EVERY account (an email-registered user who saved
  // this number included), then again atomically at createUser (alias) and at
  // profile_set_phone (unique index). Product decision: say so plainly.
  try {
    if (await isCanonicalPhoneTaken(phone.value.e164)) return fail("phoneExists", "phone", values);
  } catch (error) {
    logStepFailure("phone_precheck", error as { code?: string });
    return fail("signUpFailed", "form", values);
  }

  const loginAlias = craftsmanLoginAlias(phone.value.e164);
  let created;
  try { created = await (kind === "showroom" ? createShowroomPasswordUser : createCraftsmanPasswordUser)({
    loginAlias,
    password: password.value,
    fullName: name.value,
  }); } catch { return fail("signUpFailed", "form", values); }
  if (!created.ok) {
    if (created.reason === "exists") return fail("phoneExists", "phone", values);
    if (created.reason === "rate_limited") return fail("rateLimited", "form", values);
    if (created.reason === "rejected") return fail("passwordRejected", "password", values);
    return fail("signUpFailed", "form", values);
  }

  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginAlias,
      password: password.value,
      options: { captchaToken: sessionCaptchaToken },
    });
    if (signInError) {
      logStepFailure("session", signInError as { code?: string });
      // Token B expired, was rejected, or was already used. The account is
      // rolled back below, so nothing half-created remains and a retry cannot
      // duplicate it; the person is told to verify again, never shown success.
      throw new InitializationError(isCaptchaFailure(signInError as { code?: string; message?: string }) ? "captcha" : "failed");
    }
    await initializeCraftsmanAccount(supabase, kind, phone.value);
  } catch (error) {
    // ROLLBACK — drop the session cookies, then delete the account this call
    // just created. `deleteUser` cascades to public.users/profiles and every
    // row the steps above wrote.
    try { await supabase.auth.signOut({ scope: "global" }); } catch { logStepFailure("session_revoke", null); }
    try { await deleteCraftsmanPasswordUser(created.userId); } catch { logStepFailure("rollback", null); }
    if (error instanceof InitializationError && error.outcome === "phone_taken") {
      return fail("phoneExists", "phone", values);
    }
    if (error instanceof InitializationError && error.outcome === "captcha") {
      return fail("signInVerificationRetry", "captcha", values);
    }
    if (!(error instanceof InitializationError)) logStepFailure("initialization", error as { code?: string });
    return fail("signUpFailed", "form", values);
  }

  redirect(kind === "showroom" ? "/onboarding/business" : await resolveActiveLanding(supabase));
}

// ---------------------------------------------------------------------------
// Sign in — phone + password. One generic message for every credential
// failure (unknown number, wrong password, disabled account).
// ---------------------------------------------------------------------------
export async function phonePasswordSignIn(kind: "installer" | "showroom", _prev: CraftsmanAuthState, formData: FormData): Promise<CraftsmanAuthState> {
  if (!authFormWithinLimit(formData)) return fail("requestTooLarge", "form");
  const rawPhone = typeof formData.get("phone") === "string" ? String(formData.get("phone")) : "";
  const values = { phone: rawPhone };
  const phone = parsePhone(rawPhone, formData.get("country") ?? undefined);
  if (!phone.ok) return { ok: false, code: phone.code, field: "phone", values };
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) return fail("passwordRequired", "password", values);

  if (!loginPasswordSchema.safeParse(password).success) return fail("passwordTooLong", "password", values);
  const limited = await phoneAuthLimit("sign-in", phone.value.e164, await headers());
  if (limited !== "allowed") return fail(limited === "limited" ? "rateLimited" : "invalidCredentials", "form", values);

  // GoTrue's password grant is CAPTCHA-protected when `[auth.captcha]` is on:
  // the token is forwarded for GoTrue to judge (never also verified here).
  const captchaToken = captchaTokenFrom(formData);
  if (!captchaToken) return fail("captchaRequired", "captcha", values);

  let supabase: Client;
  let error;
  try {
  supabase = await getServerSupabase();
  ({ error } = await supabase.auth.signInWithPassword({
    email: craftsmanLoginAlias(phone.value.e164),
    password,
    options: { captchaToken },
  }));
  } catch { return fail("invalidCredentials", "form", values); }
  if (error) {
    if (isCaptchaFailure(error as { code?: string; message?: string })) return fail("captchaRejected", "captcha", values);
    if (isRateLimited(error as { code?: string; status?: number })) return fail("rateLimited", "form", values);
    return fail("invalidCredentials", "form", values);
  }

  const { data: allowed, error: authorizationError } = await supabase.rpc("phone_password_account_allowed", {
    p_kind: kind, p_phone: phone.value.e164,
  });
  if (authorizationError || allowed !== true) {
    await supabase.auth.signOut({ scope: "local" });
    return fail("invalidCredentials", "form", values);
  }

  redirect(await entryLandingPath(supabase, formData.get("next")));
}
