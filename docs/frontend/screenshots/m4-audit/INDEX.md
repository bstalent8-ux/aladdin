# M4 frontend reality audit - screenshot index

All images are real Playwright captures of the running Next.js app (port 3026) against the isolated `aladdin_sr2` database with synthetic accounts.
Generated from `manifest.jsonl` (one line per capture). "Data" says whether real backend data was on screen.

Paths are relative to `docs/frontend/screenshots/m4-audit/`. Totals: 122 screenshots.

## M2 Registration & Applications (27)

| File | Route | Persona / workspace | Locale | Theme | Viewport | State demonstrated | Data | Limitation |
|---|---|---|---|---|---|---|---|---|
| `m2-registration-applications/01-sign-up.ar.dark.390x844.png` | `/auth/sign-up` | anonymous | ar | dark | 390x844 | Sign-up with account-type choice | real | - |
| `m2-registration-applications/01-sign-up.en.light.1440x900.png` | `/auth/sign-up` | anonymous | en | light | 1440x900 | Sign-up with account-type choice | real | - |
| `m2-registration-applications/02-personal-home-no-org.en.light.1440x900.png` | `/home` | Engineer (personal, no organization) | en | light | 1440x900 | Personal home before any organization | real | - |
| `m2-registration-applications/03-operating-model.ar.dark.390x844.png` | `/business/new` | Engineer (personal, no organization) | ar | dark | 390x844 | Operating-model choice: independent vs organization | real | - |
| `m2-registration-applications/03-operating-model.en.light.1440x900.png` | `/business/new` | Engineer (personal, no organization) | en | light | 1440x900 | Operating-model choice: independent vs organization | real | - |
| `m2-registration-applications/04-form-step-name.en.light.1440x900.png` | `/business/new?model=organization` | Engineer | en | light | 1440x900 | Application form: business name | real | - |
| `m2-registration-applications/05-form-step-type.en.light.1440x900.png` | `/business/new?model=organization` | Engineer | en | light | 1440x900 | Application form: business type | real | - |
| `m2-registration-applications/06-form-step-location.en.light.1440x900.png` | `/business/new?model=organization` | Engineer | en | light | 1440x900 | Application form: location (optional) | real | - |
| `m2-registration-applications/07-form-step-branch.en.light.1440x900.png` | `/business/new?model=organization` | Engineer | en | light | 1440x900 | Application form: branch (optional) | real | - |
| `m2-registration-applications/08-form-step-review.en.light.1440x900.png` | `/business/new?model=organization` | Engineer | en | light | 1440x900 | Application form: review before submit | real | - |
| `m2-registration-applications/09-application-pending.ar.dark.1440x900.png` | `/business/applications` | Engineer, one pending application | ar | dark | 1440x900 (full page) | Pending Review + blocked second application + not-a-workspace note | real | - |
| `m2-registration-applications/09-application-pending.ar.dark.390x844.png` | `/business/applications` | Engineer, one pending application | ar | dark | 390x844 | Pending Review + blocked second application + not-a-workspace note | real | - |
| `m2-registration-applications/09-application-pending.en.light.1440x900.png` | `/business/applications` | Engineer, one pending application | en | light | 1440x900 | Pending Review + blocked second application + not-a-workspace note | real | - |
| `m2-registration-applications/10-pending-not-a-workspace.en.light.1440x900.png` | `/home` | Engineer, pending org forced via cookie | en | light | 1440x900 | Home with the pending org id forced in the workspace cookie: still personal | real | - |
| `m2-registration-applications/11-application-needs-changes.ar.dark.390x844.png` | `/business/applications` | Engineer, needs-changes application | ar | dark | 390x844 | Needs Changes with reviewer note and resubmit action | real | - |
| `m2-registration-applications/11-application-needs-changes.en.light.1440x900.png` | `/business/applications` | Engineer, needs-changes application | en | light | 1440x900 | Needs Changes with reviewer note and resubmit action | real | - |
| `m2-registration-applications/12-application-rejected.en.light.1440x900.png` | `/business/applications` | Engineer, rejected first application | en | light | 1440x900 | Rejected with reviewer reason; replacement blocked until abandon | real | - |
| `m2-registration-applications/13-abandon-confirmation.en.light.1440x900.png` | `/business/applications` | Engineer | en | light | 1440x900 | Abandon confirmation dialog | real | - |
| `m2-registration-applications/14-application-abandoned.en.light.1440x900.png` | `/business/applications` | Engineer | en | light | 1440x900 | Abandoned (history kept) and 'Start a new application' offered | real | - |
| `m2-registration-applications/15-applications-multi-org.ar.dark.390x844.png` | `/business/applications` | Engineer with 2 approved orgs + 1 pending | ar | dark | 390x844 (full page) | Approved + pending lists, additional application | real | - |
| `m2-registration-applications/15-applications-multi-org.en.light.1440x900.png` | `/business/applications` | Engineer with 2 approved orgs + 1 pending | en | light | 1440x900 | Approved + pending lists, additional application | real | - |
| `m2-registration-applications/16-workspace-switcher.en.light.1440x900.png` | `/b2b` | multi-org owner | en | light | 1440x900 | Workspace switcher open: only approved orgs + personal; pending never listed | real | - |
| `m2-registration-applications/17-consumer-business-new.en.light.1440x900.png` | `/business/applications` | Personal consumer | en | light | 1440x900 | What a consumer sees at /business/new | real | - |
| `m2-registration-applications/18-consumer-home.ar.dark.390x844.png` | `/home` | Personal consumer | ar | dark | 390x844 | Personal home | real | - |
| `m2-registration-applications/18-consumer-home.en.light.1440x900.png` | `/home` | Personal consumer | en | light | 1440x900 | Personal home | real | - |
| `m2-registration-applications/19-signup-account-types-open.ar.dark.390x844.png` | `/auth/sign-up` | anonymous | ar | dark | 390x844 | Sign-up account-type list opened: Contractor/Engineer must be Coming Soon | real | - |
| `m2-registration-applications/19-signup-account-types-open.en.light.1440x900.png` | `/auth/sign-up` | anonymous | en | light | 1440x900 | Sign-up account-type list opened: Contractor/Engineer must be Coming Soon | real | - |

## M3 Organization & Branch Governance (30)

| File | Route | Persona / workspace | Locale | Theme | Viewport | State demonstrated | Data | Limitation |
|---|---|---|---|---|---|---|---|---|
| `m3-organization-branch-governance/01-settings-initial.ar.dark.390x844.png` | `/b2b/settings` | Org owner (approved Showroom/Dealer) | ar | dark | 390x844 (full page) | Organization settings: verified identity panel + branch list (founding branch only) | real | - |
| `m3-organization-branch-governance/01-settings-initial.en.light.1440x900.png` | `/b2b/settings` | Org owner (approved Showroom/Dealer) | en | light | 1440x900 | Organization settings: verified identity panel + branch list (founding branch only) | real | - |
| `m3-organization-branch-governance/02-organization-people.en.light.1440x900.png` | `/b2b/organization` | Org owner | en | light | 1440x900 | Organization page: people + join requests | real | - |
| `m3-organization-branch-governance/03-rename-dialog.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Request-a-name-change dialog | real | - |
| `m3-organization-branch-governance/04-rename-pending.ar.dark.390x844.png` | `/b2b/settings` | Org owner | ar | dark | 390x844 (full page) | Name change Awaiting review; approved name still current | real | - |
| `m3-organization-branch-governance/04-rename-pending.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Name change Awaiting review; approved name still current | real | - |
| `m3-organization-branch-governance/05-rename-rejected.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Name change Not approved with reviewer reason | real | - |
| `m3-organization-branch-governance/06-rename-approved.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Name change approved and applied | real | - |
| `m3-organization-branch-governance/07-add-branch-dialog.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Add internal branch dialog | real | - |
| `m3-organization-branch-governance/08-branch-internal.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | New branch: Internal only, not a new organization | real | - |
| `m3-organization-branch-governance/09-branch-verification-dialog.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Request branch verification dialog | real | - |
| `m3-organization-branch-governance/10-branch-pending.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Branch verification pending | real | - |
| `m3-organization-branch-governance/11-branch-verified.ar.dark.390x844.png` | `/b2b/settings` | Org owner | ar | dark | 390x844 (full page) | Verified branch location | real | - |
| `m3-organization-branch-governance/11-branch-verified.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Verified branch location | real | - |
| `m3-organization-branch-governance/12-branch-unreviewed-edit.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Edited verified branch: flagged not yet verified; approved public record unchanged | real | - |
| `m3-organization-branch-governance/13-branch-amendment-rejected.en.light.1440x900.png` | `/b2b/settings` | Org owner | en | light | 1440x900 | Amendment rejected with reason; approved record unchanged | real | - |
| `m3-organization-branch-governance/14-coowner-member.en.light.1440x900.png` | `/business/applications` | Member with org.manage (not a verified co-owner) | en | light | 1440x900 (full page) | Membership is not ownership: Request co-owner verification offered | real | - |
| `m3-organization-branch-governance/15-coowner-request-dialog.en.light.1440x900.png` | `/business/applications` | Member | en | light | 1440x900 | Co-owner verification request dialog | real | - |
| `m3-organization-branch-governance/16-coowner-pending.ar.dark.390x844.png` | `/business/applications` | Member | ar | dark | 390x844 | Co-owner request awaiting review | real | - |
| `m3-organization-branch-governance/16-coowner-pending.en.light.1440x900.png` | `/business/applications` | Member | en | light | 1440x900 | Co-owner request awaiting review | real | - |
| `m3-organization-branch-governance/17-coowner-verified.ar.dark.1440x900.png` | `/business/applications` | Verified co-owner | ar | dark | 1440x900 (full page) | Verified co-owner: may apply for their own organization | real | - |
| `m3-organization-branch-governance/17-coowner-verified.en.light.1440x900.png` | `/business/applications` | Verified co-owner | en | light | 1440x900 | Verified co-owner: may apply for their own organization | real | - |
| `m3-organization-branch-governance/18-coowner-business-new.en.light.1440x900.png` | `/business/new` | Verified co-owner | en | light | 1440x900 | Application flow opens for a verified co-owner | real | - |
| `m3-organization-branch-governance/19-settings-sales-member.en.light.1440x900.png` | `/b2b/settings` | Sales member of the org | en | light | 1440x900 | Settings without governance controls | real | - |
| `m3-organization-branch-governance/20-showroom-connect.en.light.1440x900.png` | `/home/showroom` | Sales person (affiliating) | en | light | 1440x900 | Showroom search/connect screen | real | - |
| `m3-organization-branch-governance/21-showroom-search-results.en.light.1440x900.png` | `/home/showroom?q=Aud+Gov+Showroom+Gro` | Sales person (affiliating) | en | light | 1440x900 | Search result for the verified showroom | real | - |
| `m3-organization-branch-governance/22-showroom-branch-choice.en.light.1440x900.png` | `/home/showroom?q=Aud%20Gov%20Showroom%20Gro&org=464312c8-fae0-45d4-930f-3455b39b6ecc` | Sales person | en | light | 1440x900 | Selected showroom: branch list opened (verified branch only; internal branches absent) | real | - |
| `m3-organization-branch-governance/30-admin-verification-queue.ar.dark.390x844.png` | `/admin/verifications` | Platform Admin | ar | dark | 390x844 (full page) | Admin queue with pending M3/M4a review types (raw type labels?) | real | - |
| `m3-organization-branch-governance/30-admin-verification-queue.en.light.1440x900.png` | `/admin/verifications` | Platform Admin | en | light | 1440x900 (full page) | Admin queue with pending M3/M4a review types (raw type labels?) | real | - |
| `m3-organization-branch-governance/31-admin-organization-detail.en.light.1440x900.png` | `/admin/organizations/464312c8-fae0-45d4-930f-3455b39b6ecc` | Platform Admin | en | light | 1440x900 (full page) | Admin organization detail (any governance evidence / branch / co-owner / revoke controls?) | real | - |

## M4a Independent Publishing (29)

| File | Route | Persona / workspace | Locale | Theme | Viewport | State demonstrated | Data | Limitation |
|---|---|---|---|---|---|---|---|---|
| `m4a-independent-publishing/01-contractor-home.en.light.1440x900.png` | `/home` | Independent Contractor (personal, no org) | en | light | 1440x900 | Personal home: is there any path to independent publishing? | real | - |
| `m4a-independent-publishing/02-can-request.en.light.1440x900.png` | `/home/independent-publishing` | Independent Contractor | en | light | 1440x900 | Publishing area before any request | real | - |
| `m4a-independent-publishing/03-request-dialog.en.light.1440x900.png` | `/home/independent-publishing` | Independent Contractor | en | light | 1440x900 | Request approval dialog | real | - |
| `m4a-independent-publishing/04-pending-review.ar.dark.390x844.png` | `/home/independent-publishing` | Independent Contractor | ar | dark | 390x844 | Pending review | real | - |
| `m4a-independent-publishing/04-pending-review.en.light.1440x900.png` | `/home/independent-publishing` | Independent Contractor | en | light | 1440x900 | Pending review | real | - |
| `m4a-independent-publishing/05-approved-empty.ar.dark.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | ar | dark | 1440x900 | Approved, no products, 'not shown to other people yet' note | real | - |
| `m4a-independent-publishing/05-approved-empty.en.light.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | en | light | 1440x900 | Approved, no products, 'not shown to other people yet' note | real | - |
| `m4a-independent-publishing/06-add-product-dialog.en.light.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | en | light | 1440x900 | Add product dialog (name, code, category, unit, price, audiences) | real | - |
| `m4a-independent-publishing/07-product-draft.en.light.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | en | light | 1440x900 | Product list: one draft; actions limited to Publish (no edit / images / audiences / offers) | real | - |
| `m4a-independent-publishing/08-publish-confirm.en.light.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | en | light | 1440x900 | Publish confirmation | real | - |
| `m4a-independent-publishing/09-product-published.ar.dark.390x844.png` | `/home/independent-publishing` | Approved independent Contractor | ar | dark | 390x844 (full page) | Published product (still private while gate is closed) | real | - |
| `m4a-independent-publishing/09-product-published.en.light.1440x900.png` | `/home/independent-publishing` | Approved independent Contractor | en | light | 1440x900 | Published product (still private while gate is closed) | real | - |
| `m4a-independent-publishing/10-pro-route-0.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /b2b/products (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-1.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /b2b/offers (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-2.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /preview/showroom-suite-v2/my-products (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-3.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /preview/showroom-suite-v2/my-offers (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-4.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /preview/showroom-suite-v2/my-offers/new (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-5.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /b2b/rfqs (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-6.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /b2b/orders (final path /home) | real | - |
| `m4a-independent-publishing/10-pro-route-7.en.light.1440x900.png` | `/home` | Approved independent Contractor | en | light | 1440x900 | Direct visit to /b2b/quotations (final path /home) | real | - |
| `m4a-independent-publishing/11-buyer-independent-detail.ar.dark.390x844.png` | `/preview/showroom-suite-v2/catalog/b5b66406-e7d3-46d9-8f52-d91209e166be` | Showroom buyer (hana); gate opened in isolated test only | ar | dark | 390x844 | Independent product detail: 'requests not available yet' note, no quote button | real | - |
| `m4a-independent-publishing/11-buyer-independent-detail.en.light.1440x900.png` | `/preview/showroom-suite-v2/catalog/b5b66406-e7d3-46d9-8f52-d91209e166be` | Showroom buyer (hana); gate opened in isolated test only | en | light | 1440x900 | Independent product detail: 'requests not available yet' note, no quote button | real | - |
| `m4a-independent-publishing/12-buyer-catalog-with-independent.en.light.1440x900.png` | `/preview/showroom-suite-v2/catalog` | Showroom buyer; gate open (isolated) | en | light | 1440x900 | Catalog list including the independent product | real | - |
| `m4a-independent-publishing/13-buyer-gate-closed.en.light.1440x900.png` | `/preview/showroom-suite-v2/catalog/b5b66406-e7d3-46d9-8f52-d91209e166be` | Showroom buyer; gate CLOSED | en | light | 1440x900 | Same URL with the gate closed (default): not found | empty-state | - |
| `m4a-independent-publishing/14-suspended.ar.dark.390x844.png` | `/home/independent-publishing` | Suspended independent Contractor | ar | dark | 390x844 | Suspended: reason shown, no write controls, product list hidden | real | - |
| `m4a-independent-publishing/14-suspended.en.light.1440x900.png` | `/home/independent-publishing` | Suspended independent Contractor | en | light | 1440x900 | Suspended: reason shown, no write controls, product list hidden | real | - |
| `m4a-independent-publishing/15-revoked.en.light.1440x900.png` | `/home/independent-publishing` | Revoked independent Contractor | en | light | 1440x900 | Revoked: reason shown, may request again | real | - |
| `m4a-independent-publishing/16-engineer-can-request.en.light.1440x900.png` | `/home/independent-publishing` | Independent Engineer | en | light | 1440x900 | Engineer persona can request publishing approval | real | - |
| `m4a-independent-publishing/17-consumer-not-eligible.en.light.1440x900.png` | `/home/independent-publishing` | Personal consumer | en | light | 1440x900 | Direct visit by a non-eligible persona | empty-state | - |

## Existing Showroom Commerce (36)

| File | Route | Persona / workspace | Locale | Theme | Viewport | State demonstrated | Data | Limitation |
|---|---|---|---|---|---|---|---|---|
| `existing-showroom-commerce/b01-b2b-home.en.light.1440x900.png` | `/b2b` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | B2B dashboard | real | - |
| `existing-showroom-commerce/b02-b2b-catalog.en.light.1440x900.png` | `/b2b/catalog` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | B2B catalog | real | - |
| `existing-showroom-commerce/b03-b2b-rfqs.ar.dark.390x844.png` | `/b2b/rfqs` | Showroom/Dealer (hana, buyer + seller data) | ar | dark | 390x844 | RFQ list (buyer + supplier tabs) | real | - |
| `existing-showroom-commerce/b03-b2b-rfqs.en.light.1440x900.png` | `/b2b/rfqs` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | RFQ list (buyer + supplier tabs) | real | - |
| `existing-showroom-commerce/b04-b2b-rfq-buyer.en.light.1440x900.png` | `/b2b/rfqs/d8000001-0000-4000-8000-000000000001` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | RFQ detail (buyer side) | real | - |
| `existing-showroom-commerce/b05-b2b-rfq-supplier.en.light.1440x900.png` | `/b2b/rfqs/d2000001-0000-4000-8000-000000000001` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | RFQ detail (supplier side) | real | - |
| `existing-showroom-commerce/b06-b2b-quotations.en.light.1440x900.png` | `/b2b/quotations` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Quotations list | real | - |
| `existing-showroom-commerce/b07-b2b-quotation-supplier.en.light.1440x900.png` | `/b2b/quotations/d3000001-0000-4000-8000-000000000001` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Quotation detail (supplier editor) | real | - |
| `existing-showroom-commerce/b08-b2b-orders.ar.dark.390x844.png` | `/b2b/orders` | Showroom/Dealer (hana, buyer + seller data) | ar | dark | 390x844 | Orders list | real | - |
| `existing-showroom-commerce/b08-b2b-orders.en.light.1440x900.png` | `/b2b/orders` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Orders list | real | - |
| `existing-showroom-commerce/b09-b2b-order-buyer.en.light.1440x900.png` | `/b2b/orders/da000001-0000-4000-8000-000000000001` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Order detail (buyer) | real | - |
| `existing-showroom-commerce/b10-b2b-projects.en.light.1440x900.png` | `/b2b/projects` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Projects list | real | - |
| `existing-showroom-commerce/b11-b2b-project.en.light.1440x900.png` | `/b2b/projects/db000001-0000-4000-8000-000000000001` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Project detail | real | - |
| `existing-showroom-commerce/b12-b2b-products.en.light.1440x900.png` | `/b2b/products` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | B2B products table | real | - |
| `existing-showroom-commerce/b13-b2b-offers.en.light.1440x900.png` | `/b2b/offers` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | B2B offers | real | - |
| `existing-showroom-commerce/b14-b2b-saved.en.light.1440x900.png` | `/b2b/saved` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | B2B saved products | real | - |
| `existing-showroom-commerce/b15-b2b-organization.en.light.1440x900.png` | `/b2b/organization` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Organization / people | real | - |
| `existing-showroom-commerce/b16-b2b-settings.en.light.1440x900.png` | `/b2b/settings` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Settings | real | - |
| `existing-showroom-commerce/b17-b2b-leads.en.light.1440x900.png` | `/b2b/leads` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Sales: leads | real | - |
| `existing-showroom-commerce/p01-suite-purchase-requests-placeholder.ar.dark.390x844.png` | `/preview/showroom-suite-v2/purchase-requests` | Showroom/Dealer (hana) | ar | dark | 390x844 | Sidebar item 'Purchase requests' in the Showroom suite: placeholder page | empty-state | Placeholder served by the generic [page] route |
| `existing-showroom-commerce/p01-suite-purchase-requests-placeholder.en.light.1440x900.png` | `/preview/showroom-suite-v2/purchase-requests` | Showroom/Dealer (hana) | en | light | 1440x900 | Sidebar item 'Purchase requests' in the Showroom suite: placeholder page | empty-state | Placeholder served by the generic [page] route |
| `existing-showroom-commerce/p02-suite-customer-rfqs-placeholder.en.light.1440x900.png` | `/preview/showroom-suite-v2/customer-rfqs` | Showroom/Dealer (hana) | en | light | 1440x900 | Sidebar item 'Customer RFQs received': placeholder page | empty-state | Placeholder served by the generic [page] route |
| `existing-showroom-commerce/s01-suite-home.ar.dark.1440x900.png` | `/preview/showroom-suite-v2/home` | Showroom/Dealer (hana, buyer + seller data) | ar | dark | 1440x900 | Showroom suite home | real | - |
| `existing-showroom-commerce/s01-suite-home.en.light.1440x900.png` | `/preview/showroom-suite-v2/home` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Showroom suite home | real | - |
| `existing-showroom-commerce/s02-suite-catalog.ar.dark.390x844.png` | `/preview/showroom-suite-v2/catalog` | Showroom/Dealer (hana, buyer + seller data) | ar | dark | 390x844 | Suite catalog | real | - |
| `existing-showroom-commerce/s02-suite-catalog.en.light.1440x900.png` | `/preview/showroom-suite-v2/catalog` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite catalog | real | - |
| `existing-showroom-commerce/s03-suite-catalog-detail.en.light.1440x900.png` | `/preview/showroom-suite-v2/catalog/d7000011-0000-4000-8000-000000000011` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite product detail (org seller) with request-quote CTA | real | - |
| `existing-showroom-commerce/s04-suite-offers.en.light.1440x900.png` | `/preview/showroom-suite-v2/offers` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite offers feed | real | - |
| `existing-showroom-commerce/s05-suite-offer-detail.en.light.1440x900.png` | `/preview/showroom-suite-v2/offers/894fbc0f-5657-43f8-9906-665964770e79` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite offer detail | real | - |
| `existing-showroom-commerce/s06-suite-my-products.en.light.1440x900.png` | `/preview/showroom-suite-v2/my-products` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite my products | real | - |
| `existing-showroom-commerce/s07-suite-my-products-new.en.light.1440x900.png` | `/preview/showroom-suite-v2/my-products/new` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite product form | real | - |
| `existing-showroom-commerce/s08-suite-my-products-edit.ar.dark.390x844.png` | `/preview/showroom-suite-v2/my-products/d1000001-0000-4000-8000-000000000001/edit` | Showroom/Dealer (hana, buyer + seller data) | ar | dark | 390x844 | Suite product edit (images, audiences) | real | - |
| `existing-showroom-commerce/s08-suite-my-products-edit.en.light.1440x900.png` | `/preview/showroom-suite-v2/my-products/d1000001-0000-4000-8000-000000000001/edit` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite product edit (images, audiences) | real | - |
| `existing-showroom-commerce/s09-suite-my-offers.en.light.1440x900.png` | `/preview/showroom-suite-v2/my-offers` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite offers management | real | - |
| `existing-showroom-commerce/s10-suite-my-offers-new.en.light.1440x900.png` | `/preview/showroom-suite-v2/my-offers/new` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite offer builder | real | - |
| `existing-showroom-commerce/s11-suite-saved.en.light.1440x900.png` | `/preview/showroom-suite-v2/saved` | Showroom/Dealer (hana, buyer + seller data) | en | light | 1440x900 | Suite saved products | real | - |
