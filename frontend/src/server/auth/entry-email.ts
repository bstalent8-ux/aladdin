import "server-only";

import { redirect } from "next/navigation";
import { authFormWithinLimit } from "@/lib/auth/form-limits";
import { getServerSupabase } from "@/lib/supabase/server";
import { emailSchema, loginPasswordSchema } from "@/features/auth-password-preview/password-policy";
import { requestPasswordSignUp, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";
import { entryLandingPath, generatedEntryUsername, type CraftsmanAuthState } from "@/server/auth/phone-password";

/**
 * Email + password on the Showroom and Installer entry pages
 * (docs/frontend/entry-auth-methods.md). These pages already offer phone +
 * password; this adds the email alternative WITHOUT a second registration
 * engine:
 *
 *   - Sign-up delegates to the canonical `requestPasswordSignUp` (the same
 *     `signUp()` + 6-digit email OTP + pending-registration path `/auth/sign-up`
 *     uses), with the account type fixed by the page and an internal username
 *     generated the way the phone flow generates one. Verification and resend
 *     are the canonical `verifyPasswordSignUp` / `resendPasswordSignUpCode`.
 *   - Sign-in is a password grant followed by the database's account-type
 *     check (`account_entry_allowed`), so a Showroom account cannot enter
 *     through the Installer pages and vice versa — the same separation the
 *     phone flow enforces with `phone_password_account_allowed`.
 */

export type EntryKind = "installer" | "showroom";

const ACCOUNT_TYPE_KEY: Record<EntryKind, string> = {
  showroom: "showroom_dealer",
  installer: "installer_technician",
};

function fail(code: string, field: CraftsmanAuthState["field"], email?: string): CraftsmanAuthState {
  return { ok: false, code, field, values: email === undefined ? undefined : { email } };
}

export async function entryEmailSignUp(kind: EntryKind, prev: PasswordAuthState, formData: FormData): Promise<PasswordAuthState> {
  if (!authFormWithinLimit(formData)) return { ok: false, code: "temporaryCraftsman.error.requestTooLarge" };
  // One consent checkbox on these pages covers the three receipts the account
  // needs — exactly as the phone sign-up records them.
  const consent = formData.get("consent") === "on" ? "on" : "";
  const canonical = new FormData();
  canonical.set("displayName", String(formData.get("name") ?? ""));
  canonical.set("email", String(formData.get("email") ?? ""));
  canonical.set("username", generatedEntryUsername(kind));
  canonical.set("accountType", ACCOUNT_TYPE_KEY[kind]);
  canonical.set("password", String(formData.get("password") ?? ""));
  canonical.set("confirmPassword", String(formData.get("confirmPassword") ?? ""));
  for (const type of ["terms", "privacy", "pilot"]) canonical.set(`consent_${type}`, consent);
  const token = captchaTokenFrom(formData);
  if (token) canonical.set("captchaToken", token);
  return requestPasswordSignUp(prev, canonical);
}

export async function entryEmailSignIn(kind: EntryKind, _prev: CraftsmanAuthState, formData: FormData): Promise<CraftsmanAuthState> {
  if (!authFormWithinLimit(formData)) return fail("temporaryCraftsman.error.requestTooLarge", "form");
  const rawEmail = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) return fail("entryAuth.error.emailInvalid", "email", rawEmail);
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) return fail("temporaryCraftsman.error.passwordRequired", "password", rawEmail);
  if (!loginPasswordSchema.safeParse(password).success) return fail("temporaryCraftsman.error.passwordTooLong", "password", rawEmail);

  // Same contract as the shared email sign-in: GoTrue judges the token.
  const captchaToken = captchaTokenFrom(formData);
  if (!captchaToken) return fail("temporaryCraftsman.error.captchaRequired", "captcha", rawEmail);

  const supabase = await getServerSupabase();
  let error;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email: email.data, password, options: { captchaToken } }));
  } catch {
    return fail("entryAuth.error.invalidCredentials", "form", rawEmail);
  }
  if (error) {
    const goTrue = error as { code?: string; status?: number; message?: string };
    if (isCaptchaFailure(goTrue)) return fail("temporaryCraftsman.error.captchaRejected", "captcha", rawEmail);
    if (goTrue.status === 429 || (goTrue.code ?? "").startsWith("over_")) return fail("temporaryCraftsman.error.rateLimited", "form", rawEmail);
    // One message for unknown email, wrong password, unconfirmed email and a
    // disabled account — never which one.
    return fail("entryAuth.error.invalidCredentials", "form", rawEmail);
  }

  const { data: allowed, error: authorizationError } = await supabase.rpc("account_entry_allowed", { p_kind: kind });
  if (authorizationError || allowed !== true) {
    await supabase.auth.signOut({ scope: "local" });
    // The password was right, so naming the mismatch reveals nothing new.
    return fail(kind === "showroom" ? "entryAuth.error.notShowroomAccount" : "entryAuth.error.notInstallerAccount", "form", rawEmail);
  }

  redirect(await entryLandingPath(supabase, formData.get("next")));
}
