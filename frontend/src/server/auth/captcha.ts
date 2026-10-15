import "server-only";

/**
 * Shared helpers for the two CAPTCHA paths (docs/frontend/auth-captcha.md).
 *
 * A Turnstile token is single-use, so a token must be judged by EXACTLY ONE
 * party:
 *
 *   - GoTrue-processed operations (signUp, signInWithPassword, signInWithOtp,
 *     resend, resetPasswordForEmail) forward the token through the supported
 *     `captchaToken` option and let GoTrue validate it. The application must
 *     NOT also call Siteverify for the same token — the second validation
 *     would fail with `timeout-or-duplicate`.
 *   - Operations that bypass GoTrue (service-role Admin API user creation)
 *     keep application-level Siteverify (`verifyTurnstileToken`) with hostname
 *     and action checks.
 *
 * Nothing here logs or returns a token.
 */

/** The default hidden-input name written by `TurnstileWidget`. */
export const CAPTCHA_FIELD = "captchaToken";
/** The second, independent token a flow may need (phone sign-up's session step). */
export const CAPTCHA_SESSION_FIELD = "captchaSessionToken";

/** Cloudflare caps tokens at 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

/**
 * The token submitted in `field`, or null when it is absent, blank, not a
 * string or oversized. Callers treat null as "missing" and refuse BEFORE any
 * GoTrue call, so no email is sent and no account is touched for an
 * unchallenged request.
 */
export function captchaTokenFrom(formData: FormData, field: string = CAPTCHA_FIELD): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/**
 * True when GoTrue refused the request because of its CAPTCHA check
 * (`captcha_failed`: missing, rejected, expired or already-used token).
 * GoTrue does not distinguish those cases to the caller and neither do we.
 */
export function isCaptchaFailure(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "captcha_failed") return true;
  return typeof error.message === "string" && /captcha protection/i.test(error.message);
}
