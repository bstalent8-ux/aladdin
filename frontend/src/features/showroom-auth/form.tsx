"use client";
import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Input, Checkbox, SubmitButton, LabeledField } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { TurnstileWidget } from "@/features/auth-password-preview/turnstile-widget";
import { LockIcon, UserIcon } from "@/features/installer-phone-auth/icons";
import { checkNewPassword, parseFullName, parsePhone } from "@/features/installer-phone-auth/validation";
import { loginPasswordSchema } from "@/features/auth-password-preview/password-policy";
import { showroomSignIn, showroomSignUp } from "@/server/actions/showroom-phone-auth";
import type { CraftsmanAuthState, CraftsmanField } from "@/server/auth/phone-password";
import styles from "./showroom-auth.module.css";
const initial: CraftsmanAuthState = { ok: false };
type Errors = Partial<Record<CraftsmanField, string>>;
export function ShowroomAuthForm({ variant, next = "/b2b" }: {
    variant: "signIn" | "signUp";
    next?: string;
}) {
    const signUp = variant === "signUp";
    const { t } = useI18n();
    const [state, dispatch, pending] = useActionState(signUp ? showroomSignUp : showroomSignIn, initial);
    const [consented, setConsented] = useState(false);
    const [clientErrors, setClientErrors] = useState<Errors>({});
    const [lastState, setLastState] = useState(state);
    if (state !== lastState) {
        setLastState(state);
        setClientErrors({});
    }
    const errors: Errors = Object.keys(clientErrors).length ? clientErrors : state.code && state.field ? { [state.field]: state.code } : {};
    const error = (field: CraftsmanField) => errors[field] ? t(errors[field]!) : undefined;
    const fieldError = (field: CraftsmanField) => error(field) ? <p id={field + "-error"} role="alert" className={styles.error}>{error(field)}</p> : null;
    function onSubmit(event: FormEvent<HTMLFormElement>) {
        const data = new FormData(event.currentTarget);
        const failures: Errors = {};
        const phone = parsePhone(data.get("phone"), data.get("country"));
        if (!phone.ok)
            failures.phone = phone.code;
        const password = data.get("password");
        if (signUp) {
            const name = parseFullName(data.get("name"));
            if (!name.ok)
                failures.name = name.code;
            const checked = checkNewPassword(password, { phone: phone.ok ? phone.value : null, name: name.ok ? name.value : null });
            if (!checked.ok)
                failures.password = checked.code;
            if (data.get("confirmPassword") !== password)
                failures.confirmPassword = "temporaryCraftsman.error.passwordMismatch";
            if (data.get("consent") !== "on")
                failures.consent = "temporaryCraftsman.error.consentRequired";
        }
        else if (typeof password !== "string" || password.length === 0) {
            failures.password = "temporaryCraftsman.error.passwordRequired";
        }
        else if (!loginPasswordSchema.safeParse(password).success) {
            failures.password = "temporaryCraftsman.error.passwordTooLong";
        }
        setClientErrors(failures);
        if (Object.keys(failures).length)
            event.preventDefault();
    }
    return <form action={dispatch} onSubmit={onSubmit} className={styles.form} data-showroom-form={variant} noValidate aria-busy={pending}>
    <input type="hidden" name="next" value={next}/>
    {signUp ? <input type="hidden" name="consent" value={consented ? "on" : ""}/> : null}
    {error("form") ? <p role="alert" className={styles.error}>{error("form")}</p> : null}
    {signUp ? <LabeledField label={t("showroomAuth.name")} htmlFor="name">
      <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted"><UserIcon /></span>
      <Input className="ps-11" id="name" name="name" defaultValue={state.values?.name ?? ""} autoComplete="name" required maxLength={80} placeholder={t("showroomAuth.namePlaceholder")} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined}/>
      </div>
      {fieldError("name")}
    </LabeledField> : null}
    <LabeledField label={t("showroomAuth.phone")} htmlFor="showroom-phone">
      <div dir="ltr"><PhoneField id="showroom-phone" name="phone" countryName="country" compact joined onChange={() => { }} error={error("phone")} placeholder="010 1234 5678"/></div>
    </LabeledField>
    <LabeledField label={t("showroomAuth.password")} htmlFor="password">
      <PasswordInput id="password" name="password" leadingIcon={<LockIcon />} dir="rtl" autoComplete={signUp ? "new-password" : "current-password"} required placeholder={t("showroomAuth.passwordPlaceholder")} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : signUp ? "password-policy" : undefined}/>
      {fieldError("password")}
      {signUp && !errors.password ? <p id="password-policy" className={styles.hint}>{t("showroomAuth.passwordPolicy")}</p> : null}
    </LabeledField>
    {signUp ? <>
      <LabeledField label={t("showroomAuth.confirmPassword")} htmlFor="confirmPassword">
        <PasswordInput id="confirmPassword" name="confirmPassword" leadingIcon={<LockIcon />} dir="rtl" autoComplete="new-password" required placeholder={t("showroomAuth.confirmPlaceholder")} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}/>
        {fieldError("confirmPassword")}
      </LabeledField>
      <div>
        <div className={styles.consent}>
          <Checkbox id="showroom-consent" name="showroom-consent-choice" checked={consented} onChange={setConsented} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "consent-error" : undefined}>{t("showroomAuth.agree")} <Link href="/legal/terms">{t("showroomAuth.terms")}</Link> {t("showroomAuth.and")} <Link href="/legal/privacy">{t("showroomAuth.privacy")}</Link>
          </Checkbox>
        </div>
        {fieldError("consent")}
      </div>
      {/* Token A: judged by Aladdin (privileged account creation). Token B: forwarded to
          GoTrue for the sign-in that follows. Two tokens, each validated exactly once. */}
      <TurnstileWidget name="captchaToken" action="phone-sign-up" resetKey={state}/>
      <TurnstileWidget name="captchaSessionToken" action="phone-sign-up-session" appearance="interaction-only" resetKey={state}/>
      {fieldError("captcha")}
    </> : <>
      <TurnstileWidget name="captchaToken" action="phone-sign-in" appearance="interaction-only" resetKey={state}/>
      {fieldError("captcha")}
    </>}
    <SubmitButton className={styles.submit} pendingLabel={t("showroomAuth.pending")}>
      {t(signUp ? "showroomAuth.signUp" : "showroomAuth.signIn")}
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 3h5v18h-5M3 12h12m-5-5 5 5-5 5"/></svg>
    </SubmitButton>
  </form>;
}
