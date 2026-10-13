import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

export const dynamic = "force-dynamic";

/**
 * Registration entry point — Architecture B
 * (docs/frontend/auth-password-preview.md §Registration architecture):
 * `signUp()` sets the password atomically, so there is no interrupted
 * "confirmed but no password" state to resume here (unlike revisions 1-3's
 * Architecture A) — this page renders the form directly.
 *
 * `?type=<key>` (from the landing page's account-type menu) only PRE-SELECTS the
 * account type. It must name one of the open registration choices; anything else
 * (unknown key, a Coming Soon type) is ignored and the form behaves as before. The
 * server action still validates the submitted type, so this carries no authority.
 */
export default async function SignUpPage({ searchParams }: { searchParams?: Promise<{ type?: string }> }) {
  const { type } = (await searchParams) ?? {};
  const initialAccountType =
    typeof type === "string" && REGISTRATION_CHOICE_ORDER.includes(type) && CHOICES_BY_KEY[type]?.comingSoon !== true
      ? type
      : undefined;
  return <PasswordSignUpForm initialAccountType={initialAccountType} />;
}
