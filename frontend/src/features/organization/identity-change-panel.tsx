"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/primitives";
import { Input, LabeledField } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import {
  requestIdentityChangeAction,
  withdrawIdentityChangeAction,
} from "@/server/actions/organization-governance";

export type IdentityChangeView = {
  /** Verified identity: changes go through review. */
  locked: boolean;
  name: string;
  nameAr: string | null;
  nameEn: string | null;
  requestStatus: "pending_review" | "needs_changes" | "rejected" | null;
  proposed: { name?: string; name_ar?: string | null; name_en?: string | null } | null;
  reason: string | null;
};

const TONE = { pending_review: "info", needs_changes: "warning", rejected: "danger" } as const;

/**
 * The verified-name panel on the Business card. A verified organization cannot rename itself: the
 * owner files a request, the approved name stays public (and the business stays fully operational)
 * while it is reviewed, and an Admin approves, rejects or asks for changes. The database enforces
 * every rule - this panel only presents the request and its state.
 */
export function IdentityChangePanel({ orgId, view }: { orgId: string; view: IdentityChangeView }) {
  const { t } = useI18n();
  if (!view.locked) return null;
  const status = view.requestStatus;
  const open = status === "pending_review";

  return (
    <div className="mt-md flex flex-col gap-sm rounded-md border border-strong/70 bg-surface-2/40 p-md" data-testid="identity-panel">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-lg text-fg">{t("governance.identity.title")}</p>
        {status ? <Badge tone={TONE[status]}>{t(`governance.identity.status.${status}`)}</Badge> : null}
      </div>
      <p className="text-label text-fg-muted">{t("governance.identity.help")}</p>

      {status && view.proposed ? (
        <dl className="grid gap-1 text-body text-fg-secondary" data-testid="identity-proposed">
          <dt className="text-label text-fg-muted">{t("governance.identity.proposed")}</dt>
          {view.proposed.name ? <dd>{view.proposed.name}</dd> : null}
          {view.proposed.name_ar ? <dd dir="rtl">{view.proposed.name_ar}</dd> : null}
          {view.proposed.name_en ? <dd dir="ltr">{view.proposed.name_en}</dd> : null}
        </dl>
      ) : null}
      {view.reason && status && status !== "pending_review" ? (
        <p className="text-body text-fg-secondary" data-testid="identity-reason">
          <span className="text-label text-fg-muted">{t("governance.identity.note")}: </span>
          {view.reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-sm">
        {!open ? (
          <ConfirmDialog
            trigger={status ? t("governance.identity.requestCorrected") : t("governance.identity.request")}
            triggerVariant="outline"
            title={t("governance.identity.dialogTitle")}
            confirmLabel={t("governance.identity.confirm")}
            confirmVariant="accent"
            formAction={requestIdentityChangeAction}
          >
            <input type="hidden" name="orgId" value={orgId} />
            <p className="text-body text-fg-secondary">{t("governance.identity.dialogHelp")}</p>
            <LabeledField label={t("governance.identity.fieldName")} htmlFor="idc-name">
              <Input id="idc-name" name="name" defaultValue={view.name} maxLength={120} required />
            </LabeledField>
            <LabeledField label={t("settings.field.nameAr")} htmlFor="idc-name-ar" optional={t("common.optional")}>
              <Input id="idc-name-ar" name="nameAr" defaultValue={view.nameAr ?? ""} dir="rtl" maxLength={120} />
            </LabeledField>
            <LabeledField label={t("settings.field.nameEn")} htmlFor="idc-name-en" optional={t("common.optional")}>
              <Input id="idc-name-en" name="nameEn" defaultValue={view.nameEn ?? ""} dir="ltr" maxLength={120} />
            </LabeledField>
          </ConfirmDialog>
        ) : null}
        {status === "pending_review" || status === "needs_changes" ? (
          <ConfirmDialog
            trigger={t("governance.identity.withdraw")}
            triggerVariant="ghost"
            title={t("governance.identity.withdraw")}
            body={t("governance.identity.withdrawBody")}
            confirmLabel={t("governance.identity.withdrawConfirm")}
            confirmVariant="primary"
            formAction={withdrawIdentityChangeAction}
          >
            <input type="hidden" name="orgId" value={orgId} />
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}
