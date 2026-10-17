"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { EntryKind } from "@/server/auth/entry-email";
import type { OAuthAvailability } from "@/server/auth/entry-oauth";
import { EntryOAuthButtons } from "./oauth-buttons";

export type EntryMethod = "phone" | "email";

/** `?error=` values the OAuth callback returns with, mapped to copy. Anything else shows nothing. */
const ERROR_KEYS: Record<string, (kind: EntryKind) => string> = {
  oauth: () => "entryAuth.error.oauth",
  oauth_email: () => "entryAuth.error.oauthEmail",
  wrong_account: (kind) => (kind === "showroom" ? "entryAuth.error.notShowroomAccount" : "entryAuth.error.notInstallerAccount"),
};

export function entryErrorKey(kind: EntryKind, error: string | undefined): string | null {
  return error && Object.hasOwn(ERROR_KEYS, error) ? ERROR_KEYS[error]!(kind) : null;
}

/**
 * Every way into a Showroom or Installer account on one page: Google /
 * Facebook first (when enabled), then a Phone | Email switch over the
 * password forms. Phone stays the default, so the existing flow is unchanged
 * for anyone who does nothing new.
 */
export function EntryAuthPanel({
  kind,
  next,
  providers,
  initialMethod = "phone",
  error,
  phone,
  email,
}: {
  kind: EntryKind;
  next?: string;
  providers: OAuthAvailability;
  initialMethod?: EntryMethod;
  error?: string;
  phone: ReactNode;
  email: ReactNode;
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState<EntryMethod>(initialMethod);
  const errorKey = entryErrorKey(kind, error);
  const hasOAuth = providers.google || providers.facebook;

  const tab = (value: EntryMethod, label: string) => (
    <button
      type="button"
      role="tab"
      id={`entry-method-${value}`}
      aria-selected={method === value}
      aria-controls={`entry-method-${value}-panel`}
      onClick={() => setMethod(value)}
      className={cn(
        "min-h-11 flex-1 rounded-md px-md text-body font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        method === value ? "bg-surface text-fg shadow-card" : "text-fg-secondary hover:text-fg",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-md" data-entry-auth={kind}>
      {errorKey ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
          {t(errorKey)}
        </p>
      ) : null}
      <EntryOAuthButtons kind={kind} next={next} providers={providers} />
      {hasOAuth ? (
        <div className="flex items-center gap-sm text-label text-fg-muted" aria-hidden="true">
          <span className="flex-1 border-t border-strong" />
          {t("entryAuth.or")}
          <span className="flex-1 border-t border-strong" />
        </div>
      ) : null}
      <div role="tablist" aria-label={t("entryAuth.methodLabel")} className="flex gap-1 rounded-lg bg-surface-2 p-1">
        {tab("phone", t("entryAuth.methodPhone"))}
        {tab("email", t("entryAuth.methodEmail"))}
      </div>
      <div role="tabpanel" id={`entry-method-${method}-panel`} aria-labelledby={`entry-method-${method}`}>
        {method === "phone" ? phone : email}
      </div>
    </div>
  );
}
