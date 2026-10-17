"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { BadgeCheckIcon, PackageIcon, ShieldIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { SHARED_UNITS } from "@/features/commerce/constants";
import { PRODUCT_AUDIENCE_GROUPS } from "@/features/showroom-shell/products/product-audiences";
import {
  createIndependentProductAction,
  requestIndependentPublishingAction,
  setIndependentProductPublishedAction,
} from "@/server/actions/independent-publisher";
import {
  publishingState,
  type CategoryOption,
  type IndependentProductRow,
  type IndependentPublisherView,
  type PublishingState,
} from "./model";

const TONE: Record<PublishingState, "neutral" | "info" | "warning" | "danger" | "success"> = {
  not_eligible: "neutral",
  can_request: "neutral",
  pending_review: "info",
  needs_changes: "warning",
  rejected: "danger",
  active: "success",
  suspended: "warning",
  revoked: "danger",
};

/**
 * An independent Contractor / Engineer own publishing area.
 *
 * Commercial publishing is a separate, Admin-controlled approval - not user verification, not an
 * organization and not membership in one. Before approval nothing here can publish; after a
 * suspension or revocation every writer is refused by the database. Even an approved publisher is
 * invisible to other people while the platform independent-commerce gate is closed, which this
 * screen deliberately says out loud rather than implying public availability.
 */
export function IndependentPublishing({
  view,
  products,
  categories,
}: {
  view: IndependentPublisherView;
  products: IndependentProductRow[];
  categories: CategoryOption[];
}) {
  const { t, locale } = useI18n();
  const state = publishingState(view);
  const active = state === "active" && view.publisherId !== null;
  const canAsk =
    view.canRequest && (state === "can_request" || state === "needs_changes" || state === "rejected" || state === "revoked");

  return (
    <div className="flex flex-col gap-lg" data-testid="independent-publishing">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-headline text-fg">{t("independentPublishing.title")}</h1>
        <p className="text-body text-fg-secondary">{t("independentPublishing.subtitle")}</p>
      </header>

      <Card>
        <SectionTitle icon={<ShieldIcon size={18} />}>{t("independentPublishing.approval.title")}</SectionTitle>
        <div className="mt-md flex flex-col gap-sm" data-testid={`publishing-${state}`}>
          <div className="flex flex-wrap items-center gap-sm">
            <Badge tone={TONE[state]}>
              {active ? <BadgeCheckIcon size={13} /> : null}
              {t(`independentPublishing.state.${state}`)}
            </Badge>
          </div>
          <p className="text-body text-fg-secondary">{t(`independentPublishing.stateBody.${state}`)}</p>
          {view.reason && (state === "needs_changes" || state === "rejected" || state === "suspended" || state === "revoked") ? (
            <p className="text-body text-fg-secondary" data-testid="publishing-reason">
              <span className="text-label text-fg-muted">{t("independentPublishing.reviewerNote")}: </span>
              {view.reason}
            </p>
          ) : null}
          {active ? <p className="text-label text-fg-muted">{t("independentPublishing.notPublicYet")}</p> : null}
          {canAsk ? (
            <div>
              <ConfirmDialog
                trigger={t("independentPublishing.request")}
                triggerVariant="outline"
                title={t("independentPublishing.request")}
                confirmLabel={t("independentPublishing.send")}
                confirmVariant="accent"
                formAction={requestIndependentPublishingAction}
              >
                <p className="text-body text-fg-secondary">{t("independentPublishing.requestHelp")}</p>
                <LabeledField label={t("independentPublishing.noteLabel")} htmlFor="ip-note" optional={t("common.optional")}>
                  <Textarea id="ip-note" name="note" rows={3} maxLength={500} />
                </LabeledField>
              </ConfirmDialog>
            </div>
          ) : null}
        </div>
      </Card>

      {active ? (
        <Card>
          <SectionTitle
            icon={<PackageIcon size={18} />}
            action={
              <ConfirmDialog
                trigger={t("independentPublishing.products.add")}
                triggerVariant="outline"
                title={t("independentPublishing.products.add")}
                confirmLabel={t("independentPublishing.products.create")}
                confirmVariant="accent"
                formAction={createIndependentProductAction}
              >
                <input type="hidden" name="publisherId" value={view.publisherId!} />
                <LabeledField label={t("independentPublishing.products.name")} htmlFor="ip-name">
                  <Input id="ip-name" name="name" maxLength={160} required />
                </LabeledField>
                <LabeledField label={t("independentPublishing.products.code")} htmlFor="ip-code">
                  <Input id="ip-code" name="code" maxLength={60} required />
                </LabeledField>
                <LabeledField label={t("independentPublishing.products.category")} htmlFor="ip-cat">
                  <Select id="ip-cat" name="categoryCode" defaultValue="" required>
                    <option value="" disabled>
                      {t("independentPublishing.products.choose")}
                    </option>
                    {categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {locale === "ar" ? c.labelAr : c.labelEn}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <LabeledField label={t("independentPublishing.products.unit")} htmlFor="ip-unit">
                  <Select id="ip-unit" name="unit" defaultValue="piece" required>
                    {SHARED_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`commerce.units.${u}`)}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <LabeledField label={t("independentPublishing.products.price")} htmlFor="ip-price">
                  <Input id="ip-price" name="price" type="number" inputMode="decimal" min="0.01" step="0.01" required />
                </LabeledField>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-label text-fg-muted">{t("independentPublishing.products.audiences")}</legend>
                  <div className="grid gap-1.5 tablet:grid-cols-2">
                    {PRODUCT_AUDIENCE_GROUPS.map((g) => (
                      <label key={g.code} className="flex items-center gap-2 text-body text-fg-secondary">
                        <input type="checkbox" name="audience" value={g.code} />
                        {t(`showroomOffers.audienceGroup.${g.id}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </ConfirmDialog>
            }
          >
            {t("independentPublishing.products.title")}
          </SectionTitle>

          {products.length === 0 ? (
            <p className="mt-md text-body text-fg-muted">{t("independentPublishing.products.empty")}</p>
          ) : (
            <ul className="mt-md flex flex-col gap-sm" data-testid="independent-products">
              {products.map((p) => (
                <li key={p.id} data-testid={`ind-product-${p.status}`} className="flex flex-col gap-1.5 rounded-sm bg-surface-2/50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <span className="min-w-0 truncate text-body-lg text-fg">{p.name}</span>
                    <Badge tone={p.status === "published" ? "success" : "neutral"}>
                      {t(`independentPublishing.products.status.${p.status}`)}
                    </Badge>
                  </div>
                  <span className="text-label text-fg-muted">
                    {p.code ?? ""} · {t(`commerce.units.${p.unit}` as never)}
                  </span>
                  {!p.archived ? (
                    <div>
                      <ConfirmDialog
                        trigger={p.status === "published" ? t("independentPublishing.products.unpublish") : t("independentPublishing.products.publish")}
                        triggerVariant="outline"
                        title={p.name}
                        body={p.status === "published" ? t("independentPublishing.products.unpublishBody") : t("independentPublishing.products.publishBody")}
                        confirmLabel={p.status === "published" ? t("independentPublishing.products.unpublish") : t("independentPublishing.products.publish")}
                        confirmVariant="primary"
                        formAction={setIndependentProductPublishedAction}
                      >
                        <input type="hidden" name="productId" value={p.id} />
                        <input type="hidden" name="version" value={p.version} />
                        <input type="hidden" name="publish" value={p.status === "published" ? "false" : "true"} />
                      </ConfirmDialog>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
