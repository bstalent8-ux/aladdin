import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select } from "@/components/ui/controls";
import { BuildingIcon } from "@/components/ui/icons";
import { approveReferral, rejectReferral } from "@/server/actions/affiliation";
import type { AdminReferralRow } from "@/server/queries/affiliation";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount } from "@/lib/ui/format";
import { GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";

/**
 * Referred showrooms, on the EXISTING Admin verification surface.
 *
 * This is a review queue, not a second Admin system: platform authority, the same
 * approve/reject vocabulary, the same audit trail. What it adds is the two things a
 * reviewer needs and cannot get anywhere else — who referred the business, and
 * whether it might already be on the platform.
 *
 * The de-duplication hint is a HINT. Company name is deliberately not unique (two
 * genuinely different showrooms may share one), so a human decides whether to LINK
 * the candidate to the suggested organization or let approval create it. Linking is
 * offered first because a duplicate business is much harder to undo than a link.
 *
 * Approval never fabricates an owner: the referring salesperson becomes a Sales
 * member of the resulting organization, and a referred business that nobody has
 * claimed simply has no owner yet.
 */
export function ReferralReview({
  rows,
  m,
  locale,
}: {
  rows: AdminReferralRow[];
  m: Messages;
  locale: Locale;
}) {
  const copy = m.admin.referrals;
  const statusLabels = copy.status as Record<string, string>;
  const govLabels = m.onboarding.consumer.governorates as Record<string, string>;
  const cityLabels = m.onboarding.consumer.cities as Record<string, string>;
  const orgTypeLabels = m.orgType as Record<string, string>;

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title text-fg">{copy.title}</h2>
        <p className="text-body text-fg-secondary">{copy.subtitle}</p>
      </div>

      {rows.length === 0 ? (
        <StatePanel title={copy.empty} icon={<BuildingIcon size={20} />} />
      ) : (
        <ul className="flex flex-col gap-md">
          {rows.map((r) => {
            const location = [
              r.governorate ? (govLabels[r.governorate] ?? r.governorate) : null,
              r.city ? (cityLabels[r.city] ?? r.city) : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-md">
                  <div className="flex flex-wrap items-start justify-between gap-md">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-body-lg font-semibold text-fg">{r.displayName}</p>
                        <Badge tone="neutral">{orgTypeLabels[r.orgType] ?? r.orgType}</Badge>
                      </div>
                      {r.legalName ? (
                        <p className="text-label text-fg-secondary">
                          {copy.legalName}: {r.legalName}
                        </p>
                      ) : null}
                      {location ? <p className="text-label text-fg-secondary">{location}</p> : null}
                      {r.primaryBranchName ? (
                        <p className="text-label text-fg-secondary">
                          {copy.branch}: {r.primaryBranchName}
                        </p>
                      ) : null}
                      {r.description ? (
                        <p className="max-w-prose text-body text-fg-secondary">{r.description}</p>
                      ) : null}
                    </div>
                    <Badge tone={r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "info"}>
                      {statusLabels[r.status] ?? r.status}
                    </Badge>
                  </div>

                  {/* Attribution: who referred this business. Retained so a future
                      rewards feature can credit them; no reward is computed here. */}
                  <div className="rounded-sm border border-strong bg-surface-2 px-3 py-2">
                    <p className="text-label text-fg-muted">{copy.referredBy}</p>
                    <p className="text-body text-fg">
                      {r.referrerName}
                      {r.referrerEmail ? ` · ${r.referrerEmail}` : ""}
                    </p>
                  </div>

                  {r.status === "submitted" ? (
                    <div className="flex flex-col gap-md">
                      {r.matchId ? (
                        <div className="flex flex-col gap-sm rounded-sm border border-warning/40 bg-warning/10 px-3 py-2.5">
                          <p className="text-body font-medium text-fg">{copy.possibleDuplicate}</p>
                          <p className="text-body text-fg-secondary">
                            {copy.matches}: {r.matchName}
                            {r.matchCount > 1 ? ` (+${formatCount(r.matchCount - 1, locale)})` : ""}
                          </p>
                          <form action={approveReferral}>
                            <input type="hidden" name="referralId" value={r.id} />
                            <input type="hidden" name="linkOrganizationId" value={r.matchId} />
                            <Button type="submit">{copy.linkExisting}</Button>
                          </form>
                          <p className="text-label text-fg-muted">{copy.linkNote}</p>
                        </div>
                      ) : null}

                      <div className="grid gap-md tablet:grid-cols-2">
                        <form action={approveReferral} className="flex flex-col gap-sm">
                          <input type="hidden" name="referralId" value={r.id} />
                          {/* Creating a NEW business needs its official registered name. The referrer is never asked for it: the
                              Admin verifies it with the showroom, then approves. Linking to an existing business needs nothing. */}
                          <LabeledField
                            label={copy.approveLegalNameLabel}
                            htmlFor={`ref-legal-${r.id}`}
                            hint={copy.approveLegalNameHint}
                          >
                            <Input
                              id={`ref-legal-${r.id}`}
                              name="legalName"
                              required
                              minLength={2}
                              maxLength={120}
                              defaultValue={r.legalName ?? ""}
                            />
                          </LabeledField>
                          {/* The branch location comes from the referral. Leave this alone unless the approval was refused because
                              the referral's location is wrong (for example a city of another governorate): then correct it here. */}
                          <LabeledField
                            label={copy.approveLocationLabel}
                            htmlFor={`ref-gov-${r.id}`}
                            hint={copy.approveLocationHint}
                          >
                            <Select id={`ref-gov-${r.id}`} name="governorate" defaultValue="">
                              <option value="">{copy.approveLocationKeep}</option>
                              {GOVERNORATE_OPTIONS.map((g) => (
                                <option key={g.value} value={g.value}>
                                  {locale === "ar" ? g.ar : g.en}
                                </option>
                              ))}
                            </Select>
                          </LabeledField>
                          <LabeledField label={copy.approveCityLabel} htmlFor={`ref-city-${r.id}`}>
                            <Input id={`ref-city-${r.id}`} name="city" maxLength={80} />
                          </LabeledField>
                          <div>
                            <Button type="submit" variant={r.matchId ? "outline" : "primary"}>
                              {copy.approveNew}
                            </Button>
                          </div>
                          <p className="text-label text-fg-muted">{copy.approveNote}</p>
                        </form>

                        <form action={rejectReferral} className="flex flex-col gap-sm">
                          <input type="hidden" name="referralId" value={r.id} />
                          <LabeledField label={copy.reasonLabel} htmlFor={`ref-reason-${r.id}`}>
                            <Input id={`ref-reason-${r.id}`} name="reason" required maxLength={500} />
                          </LabeledField>
                          <div>
                            <Button type="submit" variant="outline">
                              {copy.reject}
                            </Button>
                          </div>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {r.organizationName ? (
                        <p className="text-body text-fg-secondary">
                          {copy.resultOrganization}: {r.organizationName}
                        </p>
                      ) : null}
                      {r.reason ? (
                        <p className="text-body text-fg-secondary">
                          {copy.reasonLabel}: {r.reason}
                        </p>
                      ) : null}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
