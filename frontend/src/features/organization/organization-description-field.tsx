"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { DESCRIPTION_MAX_CHARS, checkDescription, normalizeDescription } from "@/lib/text/description-limit";
import { countChars } from "@/lib/text/count-chars";
import { saveOrganizationDescriptionAction } from "@/server/actions/organization-description";

/**
 * The Business Description of the ORGANIZATION (up to 250 characters). Managers (org.manage) edit it in place with a
 * live counter; everyone else in the organization sees it read-only. `canManage` only decides what is drawn - the
 * RPC refuses everyone without a live org.manage on this organization and re-checks the limit.
 */
export function OrganizationDescriptionField({ orgId, description, canManage }: { orgId: string; description: string | null; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const saved = description ?? "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const over = countChars(value.replace(/\r\n?/g, "\n").trim()) > DESCRIPTION_MAX_CHARS;
  const unchanged = normalizeDescription(value) === normalizeDescription(saved);

  const onSave = async () => {
    setNotice(null);
    const checked = checkDescription(value);
    if (!checked.ok) {
      setError(t("showroomSettings.description.errorTooLong", { max: DESCRIPTION_MAX_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await saveOrganizationDescriptionAction(orgId, value);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.code === "tooLong"
          ? t("showroomSettings.description.errorTooLong", { max: DESCRIPTION_MAX_CHARS })
          : result.code === "forbidden"
            ? t("showroomSettings.description.errorForbidden")
            : t("showroomSettings.description.errorFailed"),
      );
      return;
    }
    setValue(result.value ?? "");
    setNotice(t("showroomSettings.description.saved"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="organization-description-field">
      <label htmlFor="organization-description" className="text-label font-medium text-fg-secondary">
        {t("showroomSettings.description.label")}
      </label>
      {canManage ? (
        <>
          <CountedTextarea
            id="organization-description"
            name="description"
            rows={4}
            value={value}
            max={DESCRIPTION_MAX_CHARS}
            unitLabel={t("showroomSettings.description.chars")}
            counterTestId="organization-description-count"
            placeholder={t("showroomSettings.description.placeholder")}
            onChange={(e) => {
              setValue(e.target.value);
              setNotice(null);
              setError(null);
            }}
          />
          {over ? <InlineError>{t("showroomSettings.description.errorTooLong", { max: DESCRIPTION_MAX_CHARS })}</InlineError> : null}
          {error && !over ? <InlineError>{error}</InlineError> : null}
          {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
          <div className="flex items-center gap-sm">
            <Button type="button" size="sm" onClick={onSave} disabled={busy || over || unchanged} data-testid="organization-description-save">
              {busy ? t("showroomSettings.description.saving") : t("showroomSettings.description.save")}
            </Button>
            <p className="text-label text-fg-muted">{t("showroomSettings.description.hint")}</p>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-body text-fg" data-testid="organization-description-readonly">
          <bdi dir="auto">{saved || t("showroomSettings.description.empty")}</bdi>
        </p>
      )}
    </div>
  );
}
