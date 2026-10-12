"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { BadgeCheckIcon, ShieldIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { requestCoOwnerVerificationAction } from "@/server/actions/organization-governance";

export type CoOwnerRow = {
  organizationId: string;
  name: string;
  relationship: "primary_owner" | "verified_co_owner" | "member";
  requestStatus: "pending_review" | "needs_changes" | "rejected" | null;
  reason: string | null;
  canRequest: boolean;
};

const STATUS_TONE = { pending_review: "info", needs_changes: "warning", rejected: "danger" } as const;

/**
 * Ownership verification for the approved businesses a person belongs to.
 *
 * Membership is not ownership. A person is a verified co-owner only after an Admin confirms it,
 * and only that confirmation (never a role, a capability or a label chosen here) makes them
 * eligible to apply for their own organization. This section only files the claim and shows its
 * state; the database creates the trusted record on approval.
 */
export function CoOwnerSection({ rows }: { rows: CoOwnerRow[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;

  return (
    <Card data-testid="co-owner-section">
      <SectionTitle icon={<ShieldIcon size={18} />}>{t("governance.coOwner.title")}</SectionTitle>
      <p className="mt-sm text-body text-fg-secondary">{t("governance.coOwner.help")}</p>
      <ul className="mt-md flex flex-col gap-sm">
        {rows.map((r) => (
          <li
            key={r.organizationId}
            data-testid={`co-owner-${r.relationship}`}
            className="flex flex-col gap-1.5 rounded-sm bg-surface-2/50 px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <span className="min-w-0 truncate text-body-lg text-fg">{r.name}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={r.relationship === "member" ? "neutral" : "success"}>
                  {r.relationship !== "member" ? <BadgeCheckIcon size={13} /> : null}
                  {t(`governance.coOwner.relationship.${r.relationship}`)}
                </Badge>
                {r.requestStatus ? (
                  <Badge tone={STATUS_TONE[r.requestStatus]}>{t(`governance.coOwner.status.${r.requestStatus}`)}</Badge>
                ) : null}
              </span>
            </div>
            {r.reason && r.requestStatus && r.requestStatus !== "pending_review" ? (
              <p className="text-label text-fg-secondary" data-testid="co-owner-reason">
                {t("governance.coOwner.reviewerNote")}: {r.reason}
              </p>
            ) : null}
            {r.canRequest ? (
              <div>
                <ConfirmDialog
                  trigger={t("governance.coOwner.request")}
                  triggerVariant="outline"
                  title={t("governance.coOwner.dialogTitle")}
                  confirmLabel={t("governance.coOwner.confirm")}
                  confirmVariant="accent"
                  formAction={requestCoOwnerVerificationAction}
                >
                  <input type="hidden" name="orgId" value={r.organizationId} />
                  <LabeledField
                    label={t("governance.coOwner.noteLabel")}
                    htmlFor={`co-note-${r.organizationId}`}
                    hint={t("governance.coOwner.noteHint")}
                    optional={t("common.optional")}
                  >
                    <Textarea id={`co-note-${r.organizationId}`} name="note" rows={3} maxLength={500} />
                  </LabeledField>
                </ConfirmDialog>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
