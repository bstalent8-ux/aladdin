"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { WizardShell } from "@/features/onboarding/wizard";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Button } from "@/components/ui/controls";
import type { OperatingModel, OperatingModelPersona } from "@/lib/onboarding/operating-model";

/**
 * Contractor and Engineer are two accounts, each operated independently or through an
 * organization. This is a CHOICE of operating model, not a new account type and not a new login:
 * "Independent" continues with the personal identity; "Organization" starts an application that an
 * Admin must approve before the organization does anything.
 */
export function OperatingModelStep({
  persona,
  independentHref = "/home",
}: {
  persona: OperatingModelPersona;
  independentHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [model, setModel] = useState<OperatingModel | null>(null);

  return (
    <WizardShell progress={null} title={t("operatingModel.title")} subtitle={t("operatingModel.subtitle")}>
      <div className="grid gap-2.5" role="radiogroup" aria-label={t("operatingModel.title")}>
        <ChoiceCard
          selected={model === "independent"}
          title={t(`operatingModel.${persona}.independent`)}
          description={t(`operatingModel.${persona}.independentBody`)}
          onSelect={() => setModel("independent")}
        />
        <ChoiceCard
          selected={model === "organization"}
          title={t(`operatingModel.${persona}.organization`)}
          description={t(`operatingModel.${persona}.organizationBody`)}
          onSelect={() => setModel("organization")}
        />
      </div>
      <p className="text-label text-fg-muted">{t("operatingModel.note")}</p>
      <Button
        type="button"
        disabled={!model}
        onClick={() => router.push(model === "organization" ? "/business/new?model=organization" : independentHref)}
      >
        {t("operatingModel.continue")}
      </Button>
    </WizardShell>
  );
}
