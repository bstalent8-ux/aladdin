"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { SubmitButton } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ownProductLifecycleAction, type OwnProductFormState } from "@/server/actions/own-products";
import { availableLifecycleActions, type OwnProductLifecycleAction, type OwnProductStatus } from "./product-input";

const initial: OwnProductFormState = { ok: false };

function Hidden({ productId, version, action }: { productId: string; version: number; action: OwnProductLifecycleAction }) {
  return (
    <>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

/** Activate / deactivate / restore: a plain one-click form. The server action revalidates the pages that show the product. */
function QuickAction({ productId, version, action }: { productId: string; version: number; action: Exclude<OwnProductLifecycleAction, "archive"> }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(ownProductLifecycleAction, initial);
  return (
    <form action={dispatch} className="inline-flex flex-col gap-1">
      <Hidden productId={productId} version={version} action={action} />
      <SubmitButton variant="outline" size="sm" pendingLabel={t("common.saving")}>
        {t(`showroomProducts.${action}`)}
      </SubmitButton>
      {state.code && !state.ok ? <span role="alert" className="text-label text-danger">{t(state.code)}</span> : null}
    </form>
  );
}

/**
 * The lifecycle buttons a product's status and the caller's capabilities allow.
 * Archiving asks first (it withdraws the product from the public catalog and
 * freezes editing); everything else is one click. The database re-checks every
 * transition — hiding a button here is a courtesy, never the control.
 */
export function LifecycleControls({
  productId,
  version,
  status,
  canWrite,
  canPublish,
}: {
  productId: string;
  version: number;
  status: OwnProductStatus;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const actions = availableLifecycleActions(status, { write: canWrite, publish: canPublish });
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-1.5" role="group" aria-label={t("showroomProducts.actions")}>
      {actions.map((action) =>
        action === "archive" ? (
          <ConfirmDialog
            key={action}
            trigger={t("showroomProducts.archive")}
            triggerVariant="ghost"
            title={t("showroomProducts.archiveTitle")}
            body={t("showroomProducts.archiveBody")}
            confirmLabel={t("showroomProducts.archiveConfirm")}
            formAction={ownProductLifecycleAction}
          >
            <Hidden productId={productId} version={version} action="archive" />
          </ConfirmDialog>
        ) : (
          <QuickAction key={action} productId={productId} version={version} action={action} />
        ),
      )}
    </div>
  );
}
