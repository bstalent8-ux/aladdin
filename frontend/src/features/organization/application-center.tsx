"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, InlineError, InlineSuccess, SectionTitle } from "@/components/ui/primitives";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { BuildingIcon, PlusIcon } from "@/components/ui/icons";
import { APPLICATION_ORG_TYPES } from "@/lib/onboarding/account-types";
import {
  blockedReasonKey,
  slotAllowsNewApplication,
  splitApplications,
  type ApplicationRow,
  type ApplicationSlot,
  type ApplicationStatus,
} from "@/lib/workspace/applications";
import {
  abandonOrganizationApplication,
  submitOrganizationApplication,
  updateApplicationNames,
} from "@/server/actions/organization-application";
import { selectWorkspace } from "@/server/actions/context";

/**
 * Organization applications — the owner's view of every organization they have applied for.
 *
 * Approved organizations (operational workspaces) and applications (records under review) are
 * deliberately separate groups. An application is NEVER offered as a workspace here, in the
 * switcher, or anywhere else: it has no audience and no commercial authority until an Admin
 * approves it. Every action is mirrored by a database rule (ownership, the one-open-application
 * limit, "a rejected application is final"), so a stale page can only be refused, never obeyed.
 */
const TONE: Record<ApplicationStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  draft: "neutral",
  pending_review: "info",
  needs_changes: "warning",
  rejected: "danger",
  approved: "success",
  abandoned: "neutral",
  closed: "neutral",
};

export function ApplicationCenter({ rows, slot }: { rows: ApplicationRow[]; slot: ApplicationSlot }) {
  const { t } = useI18n();
  const { approved, open, history } = splitApplications(rows);
  const canStart = slotAllowsNewApplication(slot);
  const blocked = blockedReasonKey(slot);
  const startLabel = approved.length > 0 ? t("orgApplications.actions.addAnother") : t("orgApplications.actions.startNew");

  return (
    <div className="flex flex-col gap-lg" data-testid="application-center">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-headline text-fg">{t("orgApplications.title")}</h1>
        <p className="text-body text-fg-secondary">{t("orgApplications.subtitle")}</p>
      </header>

      <p
        className="rounded-md border border-strong/70 bg-surface-2/40 p-md text-label text-fg-secondary"
        data-testid="not-a-workspace-note"
      >
        {t("orgApplications.notWorkspace")}
      </p>

      <section className="flex flex-col gap-sm" aria-labelledby="org-approved">
        <SectionTitle icon={<BuildingIcon size={16} />}>
          <span id="org-approved">{t("orgApplications.approved.title")}</span>
        </SectionTitle>
        {approved.length === 0 ? (
          <p className="text-body text-fg-muted">{t("orgApplications.approved.empty")}</p>
        ) : (
          approved.map((r) => <ApprovedCard key={r.organizationId} row={r} />)
        )}
      </section>

      <section className="flex flex-col gap-sm" aria-labelledby="org-open">
        <SectionTitle>
          <span id="org-open">{t("orgApplications.open.title")}</span>
        </SectionTitle>
        {open.length === 0 ? (
          <p className="text-body text-fg-muted">{t("orgApplications.open.empty")}</p>
        ) : (
          open.map((r) => <ApplicationCard key={r.organizationId} row={r} />)
        )}
      </section>

      <section className="flex flex-col gap-sm" data-testid="new-application">
        {canStart ? (
          <Link href="/business/new">
            <Button type="button" variant="primary">
              <PlusIcon size={16} />
              {startLabel}
            </Button>
          </Link>
        ) : blocked ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-md text-body text-fg" role="status" data-testid="application-blocked">
            {t(blocked)}
          </p>
        ) : null}
      </section>

      {history.length > 0 ? (
        <section className="flex flex-col gap-sm" aria-labelledby="org-history">
          <SectionTitle>
            <span id="org-history">{t("orgApplications.history.title")}</span>
          </SectionTitle>
          {history.map((r) => (
            <ApplicationCard key={r.organizationId} row={r} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function typeLabel(t: (k: string) => string, orgType: string | null, fallback: string): string {
  return orgType && (APPLICATION_ORG_TYPES as readonly string[]).includes(orgType)
    ? t(`onboarding.business.orgTypes.${orgType}`)
    : fallback;
}

function ApprovedCard({ row }: { row: ApplicationRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card pad="sm" className="flex items-center justify-between gap-md" >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-body-lg font-medium text-fg">{row.name}</p>
        <p className="text-label text-fg-muted">{typeLabel(t, row.orgType, "")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-sm">
        <Badge tone="success">{t("orgApplications.status.approved")}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await selectWorkspace(row.organizationId);
              router.push("/b2b");
            })
          }
        >
          {t("orgApplications.approved.open")}
        </Button>
      </div>
    </Card>
  );
}

function ApplicationCard({ row }: { row: ApplicationRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; code?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.code ?? "orgApplications.error.generic");
      else {
        setConfirming(false);
        router.refresh();
      }
    });

  const editable = row.status === "draft" || row.status === "needs_changes";

  return (
    <Card pad="sm" className="flex flex-col gap-sm" >
      <div className="flex items-start justify-between gap-md" data-testid={`application-${row.status}`}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-body-lg font-medium text-fg">{row.name}</p>
          <p className="text-label text-fg-muted">{typeLabel(t, row.orgType, "")}</p>
        </div>
        <Badge tone={TONE[row.status]}>{t(`orgApplications.status.${row.status}`)}</Badge>
      </div>

      <p className="text-body text-fg-secondary">{t(`orgApplications.statusBody.${row.status}`)}</p>

      {row.reason ? (
        <div className="rounded-md border border-strong/70 bg-surface-2/40 p-sm" data-testid="reviewer-note">
          <p className="text-label font-medium text-fg-muted">{t("orgApplications.reviewerNote")}</p>
          <p className="break-words text-body text-fg">{row.reason}</p>
        </div>
      ) : null}

      {editable ? <NamesForm orgId={row.organizationId} onDone={() => router.refresh()} /> : null}

      {error ? <InlineError>{t(error)}</InlineError> : null}

      <div className="flex flex-wrap items-center gap-sm">
        {row.canSubmit ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => run(() => submitOrganizationApplication(row.organizationId))}
          >
            {row.status === "needs_changes" ? t("orgApplications.actions.resubmit") : t("orgApplications.actions.submit")}
          </Button>
        ) : null}
        {row.canAbandon && !confirming ? (
          <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
            {t("orgApplications.actions.abandon")}
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <div className="flex flex-col gap-sm rounded-md border border-danger/40 bg-danger/5 p-sm" role="alertdialog" aria-label={t("orgApplications.actions.abandon")}>
          <p className="text-body text-fg">{t("orgApplications.actions.abandonConfirm")}</p>
          <div className="flex gap-sm">
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => run(() => abandonOrganizationApplication(row.organizationId))}
            >
              {t("orgApplications.actions.abandonYes")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              {t("orgApplications.actions.keep")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function NamesForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [ar, setAr] = useState("");
  const [en, setEn] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex flex-col gap-sm"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateApplicationNames({ orgId, nameAr: ar, nameEn: en });
          setMsg(res.ok ? { ok: true, text: t("orgApplications.names.saved") } : { ok: false, text: t(res.code ?? "orgApplications.error.generic") });
          if (res.ok) onDone();
        });
      }}
    >
      <p className="text-label font-medium text-fg-muted">{t("orgApplications.names.heading")}</p>
      <div className="grid gap-sm tablet:grid-cols-2">
        <LabeledField label={t("orgApplications.names.ar")} htmlFor={`nar-${orgId}`}>
          <Input id={`nar-${orgId}`} dir="rtl" value={ar} maxLength={120} onChange={(e) => setAr(e.target.value)} />
        </LabeledField>
        <LabeledField label={t("orgApplications.names.en")} htmlFor={`nen-${orgId}`}>
          <Input id={`nen-${orgId}`} dir="ltr" value={en} maxLength={120} onChange={(e) => setEn(e.target.value)} />
        </LabeledField>
      </div>
      <div>
        <Button type="submit" variant="outline" size="sm" disabled={pending || (!ar.trim() && !en.trim())}>
          {t("orgApplications.names.save")}
        </Button>
      </div>
      {msg ? msg.ok ? <InlineSuccess>{msg.text}</InlineSuccess> : <InlineError>{msg.text}</InlineError> : null}
    </form>
  );
}
