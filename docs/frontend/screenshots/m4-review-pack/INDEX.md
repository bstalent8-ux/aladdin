# M4 review pack - selected real screenshots

Selected from the 122-screenshot audit archive (`../m4-audit/`, untouched) plus the B-1 after-fix capture. Every image is a real Playwright capture of the running Next.js app against the isolated `aladdin_sr2` database with synthetic accounts - no concepts, no mock-ups, nothing generated. No credentials, tokens or real personal data appear. Dev-only overlay: the round "N" badge at the bottom-left is the Next.js development indicator and does not exist in a production build.

33 screenshots. `contact-sheet.png` shows them all; `manifest.json` has the same data as this index.

## M2 Registration and applications

### 01 - `01-19-signup-account-types-open.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/auth/sign-up` |
| Account / persona | anonymous |
| State | Sign-up account-type list opened: Contractor/Engineer must be Coming Soon |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Account-type list; Contractor, Engineer and Personal Account are marked Coming soon. |
| Incomplete / needs approval | Personal Account also shows Coming soon - unresolved observation, not changed. |

### 02 - `02-03-operating-model.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/new` |
| Account / persona | Engineer (personal, no organization) |
| State | Operating-model choice: independent vs organization |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Engineer chooses independent or organization; one account either way. |
| Incomplete / needs approval | Contractor path is Coming Soon; no way to see this choice as a Contractor. |

### 03 - `03-09-application-pending.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Engineer, one pending application |
| State | Pending Review + blocked second application + not-a-workspace note |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Pending Review, "applications are not workspaces" note, second application blocked. |
| Incomplete / needs approval | Nothing incomplete; visual approval only. |

### 04 - `04-11-application-needs-changes.ar.dark.390x844.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Engineer, needs-changes application |
| State | Needs Changes with reviewer note and resubmit action |
| Device / viewport | mobile 390x844 |
| Locale / theme | ar / dark |
| What is working | Needs Changes with the reviewer note, editable names, resubmit and cancel (Arabic RTL, dark, mobile). |
| Incomplete / needs approval | Resubmit was shown but not exercised end to end in the browser. |

### 05 - `05-12-application-rejected.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Engineer, rejected first application |
| State | Rejected with reviewer reason; replacement blocked until abandon |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Rejected with the reviewer reason; replacement blocked until the application is abandoned. |
| Incomplete / needs approval | Visual approval only. |

### 06 - `06-13-abandon-confirmation.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Engineer |
| State | Abandon confirmation dialog |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Abandon confirmation; history is kept after confirming. |
| Incomplete / needs approval | Visual approval only. |

### 07 - `07-15-applications-multi-org.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Engineer with 2 approved orgs + 1 pending |
| State | Approved + pending lists, additional application |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Approved organizations with Open workspace, open application, additional-application block, ownership verification card. |
| Incomplete / needs approval | A second submission by an approved owner was not exercised in the browser. |

### 08 - `08-16-workspace-switcher.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b` |
| Account / persona | multi-org owner |
| State | Workspace switcher open: only approved orgs + personal; pending never listed |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Workspace switcher: personal and approved organizations only; pending organizations never listed. |
| Incomplete / needs approval | Two switcher implementations exist (b2b and Showroom suite) - to be unified. |

## M3 Organization governance

### 09 - `09-01-settings-initial.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner (approved Showroom/Dealer) |
| State | Organization settings: verified identity panel + branch list (founding branch only) |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Organization settings with the verified-name panel and verification status. |
| Incomplete / needs approval | Visual approval only. |

### 10 - `10-01-settings-initial.ar.dark.390x844.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner (approved Showroom/Dealer) |
| State | Organization settings: verified identity panel + branch list (founding branch only) |
| Device / viewport | mobile 390x844 (full page) |
| Locale / theme | ar / dark |
| What is working | Same screen on mobile, Arabic RTL, dark (full page). |
| Incomplete / needs approval | Very long single page; section grouping is a design question. |

### 11 - `11-04-rename-pending.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner |
| State | Name change Awaiting review; approved name still current |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Rename request awaiting review; the approved name stays current. |
| Incomplete / needs approval | Visual approval only. |

### 12 - `12-06-rename-approved.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner |
| State | Name change approved and applied |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | BEFORE the B-1 fix (historical evidence): the corrected request was approved and the name changed. |
| Incomplete / needs approval | BUG: the panel still shows "Not approved", the old reviewer note and "Send a corrected request". |

### 13 - `13-b1-02-after-fix-approved.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner (same scenario that showed the bug) |
| State | B-1 AFTER the fix: corrected request approved - no stale rejection, no old note, normal request action |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | AFTER the B-1 fix, same scenario: no stale rejection or note, approved name current, normal "Request a name change". |
| Incomplete / needs approval | Visual approval only. |

### 14 - `14-b1-02-after-fix-approved.ar.dark.390x844.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner (same scenario that showed the bug) |
| State | B-1 AFTER the fix: corrected request approved - no stale rejection, no old note, normal request action |
| Device / viewport | mobile 390x844 |
| Locale / theme | ar / dark |
| What is working | AFTER the fix on mobile, Arabic RTL, dark. |
| Incomplete / needs approval | Visual approval only. |

### 15 - `15-08-branch-internal.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner |
| State | New branch: Internal only, not a new organization |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | A new branch is "Internal only"; it is not a new organization and is not shown as verified. |
| Incomplete / needs approval | Visual approval only. |

### 16 - `16-12-branch-unreviewed-edit.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/settings` |
| Account / persona | Org owner |
| State | Edited verified branch: flagged not yet verified; approved public record unchanged |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Verified branch state; an edit is flagged "not yet verified" while the approved public record stays unchanged. |
| Incomplete / needs approval | Visual approval only. |

### 17 - `17-17-coowner-verified.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/business/applications` |
| Account / persona | Verified co-owner |
| State | Verified co-owner: may apply for their own organization |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Verified co-owner state; may now apply for their own organization. |
| Incomplete / needs approval | Lives on the Applications page, which is only reachable from the workspace switcher. |

### 18 - `18-22-showroom-branch-choice.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home/showroom?q=Aud%20Gov%20Showroom%20Gro&org=464312c8-fae0-45d4-930f-3455b39b6ecc` |
| Account / persona | Sales person |
| State | Selected showroom: branch list opened (verified branch only; internal branches absent) |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Public branch listing in Connect showroom: only the verified branch is selectable; internal branches are absent. |
| Incomplete / needs approval | Visual approval only. |

### 19 - `19-30-admin-verification-queue.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/admin/verifications` |
| Account / persona | Platform Admin |
| State | Admin queue with pending M3/M4a review types (raw type labels?) |
| Device / viewport | desktop 1440x900 (full page) |
| Locale / theme | en / light |
| What is working | Admin queue (not modified) - documents the missing reviewer evidence. |
| Incomplete / needs approval | MISSING: raw type string "independent_publisher", no evidence, no governance actions. Admin workstream. |

## M4a Independent publishing

### 20 - `20-01-contractor-home.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home` |
| Account / persona | Independent Contractor (personal, no org) |
| State | Personal home: is there any path to independent publishing? |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Independent Contractor personal home. |
| Incomplete / needs approval | LIMITATION: no link, menu item or switcher entry leads to independent publishing. |

### 21 - `21-02-can-request.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home/independent-publishing` |
| Account / persona | Independent Contractor |
| State | Publishing area before any request |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Publishing approval request state. |
| Incomplete / needs approval | Reachable only by typing the URL. |

### 22 - `22-04-pending-review.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home/independent-publishing` |
| Account / persona | Independent Contractor |
| State | Pending review |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Pending approval state. |
| Incomplete / needs approval | Visual approval only. |

### 23 - `23-05-approved-empty.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home/independent-publishing` |
| Account / persona | Approved independent Contractor |
| State | Approved, no products, 'not shown to other people yet' note |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Approved publisher; "not shown to other people yet" while the gate is closed. |
| Incomplete / needs approval | Single card; no hub, no offers, no navigation. |

### 24 - `24-07-product-draft.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home/independent-publishing` |
| Account / persona | Approved independent Contractor |
| State | Product list: one draft; actions limited to Publish (no edit / images / audiences / offers) |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Current product creation result: one draft with Publish only. |
| Incomplete / needs approval | LIMITATION: no edit, images, price or audience change, no preview. Independent Offers UI does not exist. |

### 25 - `25-09-product-published.ar.dark.390x844.png`

| Field | Value |
|---|---|
| Route | `/home/independent-publishing` |
| Account / persona | Approved independent Contractor |
| State | Published product (still private while gate is closed) |
| Device / viewport | mobile 390x844 (full page) |
| Locale / theme | ar / dark |
| What is working | Product list on mobile, Arabic RTL, dark. |
| Incomplete / needs approval | Not a daily-workflow screen; needs the approved hub design. |

### 26 - `26-10-pro-route-0.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/home` |
| Account / persona | Approved independent Contractor |
| State | Direct visit to /b2b/products (final path /home) |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | What an approved independent sees after opening /b2b/products (same for offers, RFQs, orders, quotations). |
| Incomplete / needs approval | LIMITATION: silently lands on /home - no explanation. |

### 27 - `27-11-buyer-independent-detail.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/catalog/b5b66406-e7d3-46d9-8f52-d91209e166be` |
| Account / persona | Showroom buyer (hana); gate opened in isolated test only |
| State | Independent product detail: 'requests not available yet' note, no quote button |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Buyer view of an independent product (gate opened in an isolated test only). |
| Incomplete / needs approval | Dead end by design until M4b: "Requests to this seller are not available yet". |

## Existing Showroom commerce

### 28 - `28-s01-suite-home.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/home` |
| Account / persona | Showroom/Dealer (hana, buyer + seller data) |
| State | Showroom suite home |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Showroom suite dashboard. |
| Incomplete / needs approval | Suite lives under a /preview URL. |

### 29 - `29-s06-suite-my-products.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/my-products` |
| Account / persona | Showroom/Dealer (hana, buyer + seller data) |
| State | Suite my products |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | My Products list (suite shell). |
| Incomplete / needs approval | Duplicates /b2b/products (see next). |

### 30 - `30-b12-b2b-products.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/b2b/products` |
| Account / persona | Showroom/Dealer (hana, buyer + seller data) |
| State | B2B products table |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Same function in the /b2b shell. |
| Incomplete / needs approval | DUPLICATION: two shells, two screens, two navigations for one function. |

### 31 - `31-s08-suite-my-products-edit.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/my-products/d1000001-0000-4000-8000-000000000001/edit` |
| Account / persona | Showroom/Dealer (hana, buyer + seller data) |
| State | Suite product edit (images, audiences) |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Product editor with the 3-photo image manager and status panel. |
| Incomplete / needs approval | Seeded product has no category or price (seed data). |

### 32 - `32-s10-suite-my-offers-new.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/my-offers/new` |
| Account / persona | Showroom/Dealer (hana, buyer + seller data) |
| State | Suite offer builder |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Product Offers builder with live preview and completeness checklist. |
| Incomplete / needs approval | Organization-scoped; not usable by an independent. |

### 33 - `33-p01-suite-purchase-requests-placeholder.en.light.1440x900.png`

| Field | Value |
|---|---|
| Route | `/preview/showroom-suite-v2/purchase-requests` |
| Account / persona | Showroom/Dealer (hana) |
| State | Sidebar item 'Purchase requests' in the Showroom suite: placeholder page |
| Device / viewport | desktop 1440x900 |
| Locale / theme | en / light |
| What is working | Example placeholder: 15 of 21 suite sidebar items open this page. |
| Incomplete / needs approval | LIMITATION: "This page is not available yet". Approved: hide until built (F2 plan). |
