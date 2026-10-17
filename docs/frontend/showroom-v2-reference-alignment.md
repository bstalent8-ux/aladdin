# Showroom V2 - reference alignment, Settings corrections and privacy audit

Branch `feature/showroom-fullstack-v2`, isolated Supabase `aladdin_sr2`. Evidence: `docs/frontend/screenshots/v2-reference-alignment/` (untracked), specs `frontend/e2e/audit/v2-{reference,settings}.spec.ts`, pgTAP `supabase/tests/{81,82,83}_*.sql`.

## 1. The reference was opened

`docs/frontend/references/showroom-suite-v2/showroom-home-reference-v2.png` (1.7 MB) was read and inspected before any Home change. It is an Arabic (RTL), light-mode composition: header with the title "معرضك اليوم" and subtitle, a period selector on the far side, **five** KPI cards, a "اكتشف منتجات جديدة" panel with **six** image cards, and below it two panels - "أحدث عروض الأسعار الواردة" (right) and "المشتريات حسب الفئة" (left, donut + legend). Its sidebar is a simplified mock-up and its values are examples.

## 2. Reference vs implementation (side by side)

Comparison image: `docs/frontend/screenshots/v2-reference-alignment/compare-home-ar-light.png` (reference left, implementation right, same width). Implementation captures: `v2-reference-alignment/v2-release/r01-home.*`.

| Area | Reference | Implementation | Verdict |
|---|---|---|---|
| Header | icon chip + title + subtitle; period selector at the far side | same; the KPI-customization pencil sits beside the period selector | matches (+ required customize trigger) |
| KPI row | 5 cards: Total purchases, Orders awaiting execution, Completed purchase orders, Incoming quotations, Direct RFQs; icon chip, value, label, trend, "view" link | same 5, same order, same anatomy | matches |
| KPI trend line | "↑ this month", "27% from last month", "as is" | **computed** against the previous period of equal length ("↑ 25% from the previous period", "New in this period", "No activity yet", "As is" for right-now figures) | differs in wording: the reference numbers are examples; ours are derived from two real readings |
| Discover panel | 6 cards: image, category badge, name, supplier, **city with pin**, outlined "view product" button | 6 cards: signed image, category badge, name, supplier (+ verified mark), outlined button; **no city** | one deliberate difference, see section 4 |
| Latest quotations | rows with thumbnail, supplier, subtitle, date, price, status pill | same row anatomy; thumbnail is the product image when the viewer's audience may see it, else a neutral product tile; status pills Awaiting your decision / Accepted / Declined | matches; pill colours follow V2 tones, there is no "Open" status in the data |
| Category panel | donut with total in the centre, ruled legend (swatch, name, amount, %), a second period selector inside the card | same donut and legend; the period is stated in the subtitle, **no second selector** | differs: a second independent selector would duplicate the page period control; the subtitle shows the period |
| Sidebar | simplified 11-item list | the existing V2 sidebar (capability-gated groups, all working modules) | intentionally kept: removing working navigation to match a mock-up would remove completed features |
| Top bar | user at the far side, search, notifications, language, theme | same plus the Chat panel and the branch switcher added earlier | matches + completed features |
| Surfaces | raised cream panels, rounded corners | `rounded-lg border bg-surface shadow-card` panels | matches |
| KPI card height / density | compact cards (about 120 px tall) | cards are taller (about 150 px) because the label can wrap to two lines and the link row is always present | minor, not changed |
| Imagery | real product photographs, four-colour donut | real photographs where the viewer's audience may see an image (the seeded demo has a few placeholder tiles, e.g. a flat purple regression product); two categories in the donut because the demo organization has two | data, not design |
| Responsive | n/a (desktop only) | desktop 6-up product grid and 5-up cards; tablet 3-up; phones 2-up cards (last one full width), product row scrolls, quotation rows stack. No horizontal overflow at 390/430 in AR/EN light/dark (R-2) | additional |

## 3. Home sections: retained and removed

Retained (all in the reference): header, period selector, five KPI cards (+ "Show more" row only if the user chose more than five), Discover new products, Latest incoming quotations, Purchasing by category.

Removed from the Home presentation (not in the reference): the standalone Quick actions, "What you can do here", Active Direct RFQs and the Needs-attention section. Nothing was deleted from the domain: the RFQ list, quotations, orders, follow-ups and join requests keep their pages and sidebar entries (`/b2b/rfqs`, `/b2b/quotations`, `/b2b/orders`, `/b2b/follow-ups`, Team).

KPI figures (each independently re-derived in SQL by `R-4`, same 30-day Cairo window; values match):

| Card | Definition | Source |
|---|---|---|
| Total purchases | sum of `total` of non-cancelled orders this organization placed, confirmed in the period | `showroom_home_metrics` |
| Orders awaiting execution | orders placed by this organization with status `confirmed` (not yet started); a "right now" figure, shown "As is" | `order_list` (new count, no migration) |
| Completed purchase orders | orders placed, status `completed`, `completed_at` in the period | `order_list` (new count) |
| Incoming quotations | non-draft quotations addressed to this organization created in the period | `showroom_home_metrics` |
| Direct RFQs | RFQs this organization sent in the period (submitted, quoted or closed) | `showroom_home_metrics` |

Data limitations reported, not hidden: no showroom rating exists; no membership/subscription state exists; Shared Purchase Requests have no frontend (Milestone D); the supplier **city** on product cards has no approved public source (the only public location function, `showroom_branches`, returns id and name for Showroom organizations only, and adding a new public location read would be new exposure). The reference's category names are examples: the chart uses the broad sector categories the order lines map to (`order_category_spend`), unattributable lines appear as Other.

**KPI customization ("تخصيص بطاقات المؤشرات") is preserved and now governs the page.** The saved layout (personal, else team default) decides which cards show and in what order; the reference's five are the default. A caller who may not see one of the five simply sees four - no substitute figure is drawn. Two values were added to the allow-list (migration `20261024090001`: `completed_orders`, `orders_awaiting_execution`; the per-layout limit is 12). Browser test `R-3`: reorder, hide, add another card, save, persists across reload, reset restores the default. Team-default scope is covered by the existing unit/pgTAP tests (66, 81) but was not driven in the browser.

## 4. Settings corrections

| Item | Result |
|---|---|
| Business language / timezone | Removed from the Business Profile summary, from the names dialog and from the legacy `/b2b/settings` summary. The database columns and every calendar calculation are untouched. The names form keeps the current timezone in a hidden field so saving names can never clear it. The global AR/EN switch is unchanged. |
| Names dialog | Verified organizations no longer show an Edit button (the only editable field was the timezone); the name still changes only through the Admin-reviewed "Request a name change". Unverified organizations keep editing the Arabic/English display names. |
| "Workspace address" (`cairo-ceramics`) | Verified below; hidden from the Business Profile. The identifier is untouched. |
| Showroom profile image | New (section 5). |
| Personal account section | Adds a plain statement separating the personal account from the business identity (section 6). |

### Verified meaning of `cairo-ceramics`

- It is `organizations.slug` (nullable text, unique partial index `uq_organizations_slug`, format `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 80 characters). It is a **public handle** for the organization, not a workspace URL: no route in the application reads it.
- It is publicly exposed: `organization_public_directory` (granted to `anon`) and the catalog/offer views carry it (`supplier_slug`, `seller.slug`).
- It is a protected identity field: the trigger `organizations_identity_guard` allows a verified organization's name/slug to change only through the Admin-reviewed identity request (`organization_identity_change_request`, which validates format and uniqueness and reports `invalid_slug`/`slug_taken`).
- Safe to edit? Not directly. Its only change path is that review. The UI label "Workspace address" was misleading, so the field is hidden; nothing was renamed or migrated, and the browser test asserts the value is unchanged.

## 5. Showroom profile image

- **Audit first.** `organizations.logo_media_id` already existed (nullable uuid, no foreign key "added by a later media migration", never written, never read by any screen) and is included in the public directory view as an id. There was no business-image infrastructure; the personal avatar uses a different table and bucket.
- **Implementation** (migration `20261024090002`): private bucket `organization-images` (3 MB, JPEG/PNG/WebP); table `organization_images` (pending -> ready -> deleted, key prefixed with the organization id); RPCs `organization_image_request_upload / confirm_upload / remove / current`; the same select -> crop (square) -> upload -> confirm flow as the avatar, with replace and remove (the previous object is deleted after the switch).
- **Security.** Writes require `org.manage` on that organization, re-checked live in the RPC and in the storage policies. Reads are members-only (signed URL minted with the caller's own client; no public or anon access). `logo_media_id` can no longer be written by a client directly (column UPDATE revoked), so a manager cannot aim it at another organization's image. A manager keeps visibility of superseded objects only to delete them. Audit actions `organization.image_set/removed`. pgTAP 82 (32 assertions) and browser tests S-2/S-3/S-4 cover manager, staff (sees the image, no controls, RPCs refused with 42501), another organization (null key, no signed URL, upload refused), replace, remove, and that the owner's personal avatar pointer never changes.
- **Exposure audit.** The image is rendered only in Settings > Business profile for members. It is **not** used in the public directory, the catalog, the workspace menu or any public profile. The public directory view still lists `logo_media_id` (an id that resolves to nothing for non-members). Making the image public later needs an explicit decision plus a sign-only public policy.
- **Not built:** gallery, cover image, public display.

## 6. Personal-data privacy audit (field by field)

Verified from the live schema and RPCs, then locked with pgTAP 83 (24 assertions, all pass). No confirmed defect, so **no privacy correction was needed**; the migration set contains no privacy change.

| Field | Where it lives | Self | Colleague (member) | Org manager | Another organization (RFQ, quotation, order, chat, notification) | Public / anonymous |
|---|---|---|---|---|---|---|
| Login e-mail | `auth.users` | yes (masked in Settings) | no | **masked only** in `org_members_list` / `org_join_requests_list` (needs `org.members.manage`) | no | no |
| Personal phone | `profiles.phone_*` | yes | no (profiles RLS is self-only) | no | no | no |
| Personal WhatsApp | no personal field exists | - | - | - | - | - |
| Display name | `profiles.display_name` | yes | only via the assignee picker (`sales_assignable_members`, name only, needs `sales.assign`) | yes in the member list | no: documents show **organization** names; messages carry user/org uuids that no one else can resolve | only if the owner publishes a professional profile (`profile_public_directory`, default `hidden`, anon-readable when `listed`) |
| Username | `profiles.username` | yes | no | no | no | no |
| Personal avatar | `avatar_uploads` | yes | no | no | no | only a current avatar object can be signed, and its key is not exposed anywhere |
| Account type (persona) | `users.primary_account_type` | yes | no | yes in member list | no | with a listed professional profile |
| Business phone / WhatsApp / e-mail | `organization_contacts` (separate record) | org managers | no | yes | **per-channel consent flags** (`show_phone/whatsapp/email`) through `business_contact`, and only for an active verified organization and an active viewing workspace | no |
| Business identity (name, handle, type, verified, image id) | `organizations` | members | members | yes | name and verified mark | `organization_public_directory`: id, name, slug, type, verified, locale, locality, `logo_media_id` - no personal or contact fields |
| Notifications | `notifications` | recipient only | no | no | no | no; parameters carry organization names only |
| Platform support role | `profiles_select_platform`, `users_select_platform` | - | - | - | - | platform staff with the support role can read profile rows (existing Admin capability; unchanged) |

Findings that need a product decision (not changed):
1. A person with a business persona who chooses to list a professional profile appears in the anonymous professional directory under their **personal** name. It is opt-in (default hidden) and unrelated to the Showroom's public identity, but the Showroom Settings page does not surface the toggle or explain it.
2. Ordinary members cannot see their colleagues at all (stricter than the "minimal colleague identity" policy). Whether members should see a name-only roster is undecided.
3. Managers see the colleague's persona and a masked address. Confirm that is the intended minimum.
4. Platform support staff can read personal profile rows including phone numbers; confirm the Admin access policy when the Admin workstream lands.

## 7. Workspace switcher terminology

`workspace.addBusiness` = «طلب إضافة مؤسسة جديدة» / "Request New Organization"; `orgApplications.title` = «مؤسساتي وطلباتي» / "My Organizations & Applications" (also the heading of the existing applications page). The V2 menu now reads both from the message catalog instead of hard-coded strings; routes (`/preview/showroom-suite-v2/add-business`, `/business/applications`), eligibility, Admin approval, branch creation (Settings > Branches) and the rule that pending organizations never appear as workspaces are unchanged. Tests: `workspace-menu.test.tsx` (AR/EN labels, hrefs, no old text, nothing offered without eligibility), regression B4/D7/G3 updated or passing, legacy-harness specs updated for consistency (not run).

## 10. Business Description and the 250-character rule

**What was found (measured on the local database, not assumed).**

| Field | Limit before | What happened to an over-limit value | Now |
|---|---|---|---|
| Business description of the **organization** | **none - no column existed** | n/a. The description typed at registration was saved only on the draft (`business_creation_drafts.description`) and was **never copied to the organization**, so it was lost on submit | new canonical `organizations.description`, <= 250 (CHECK + RPC) |
| `business_creation_drafts.description` (registration) | 1000 (table) | the save RPC **silently truncated** with `left(..., 1000)` | RPC rejects > 250; copied to the organization on submit |
| `business_onboarding.description` | 1000 (table) | no writer other than the submit hand-off | direct-write trigger only |
| `profiles.bio` (personal / professional bio) | 1000 (table) | the save RPC **silently truncated** at 1000; clients also hold a direct UPDATE grant on the column | RPC rejects a new/changed bio > 250; trigger guards the direct grant |
| `portfolio_items.description` | 600 (table) | the RPC stored it as is | RPC + trigger |
| `products.short_description` | 250 in `own_product_validate` since `20261017090002`; the legacy `create_product/update_product` had only a 5000 ceiling | accepted by the legacy path | trigger guards every path; the legacy form now counts and shows the limit |
| `product_offers.description` | 250 in `offer_validate_text`; 5000 ceiling | - | trigger as a safeguard |

**Decisions implemented (migration `20261025090001_organization_description_250.sql`, additive).**
- One canonical business description: `organizations.description` (nullable text, CHECK <= 250). It belongs to the organization, never to its creator's personal profile (pgTAP D-22, browser DS-3). Written only by `public.organization_description_set(org, text)`: live `org.manage` check, audit event `organization.description_changed` (length only, never the text), no client UPDATE/INSERT grant on the column.
- One counting rule everywhere: **Unicode characters** (PostgreSQL `char_length`; an Arabic letter or an emoji counts once; a CRLF/CR line break counts once, exactly like the browser counter). Edges are trimmed and whitespace-only becomes null. Over the limit is **rejected, never truncated**. The `maxLength` attributes (which silently cut pasted text) were replaced by a counter that turns red plus a message.
- **Legacy values are never cut and never block an unrelated edit.** The write RPCs (`individual_save_professional`, `portfolio_item_update`) and the direct-write trigger accept a value that is **unchanged**, even if longer than 250; changing it to another over-limit text is rejected, shortening it is accepted. The old generous table CHECKs (600/1000/5000) deliberately stay as ceilings so no historical row is invalidated and no data is rewritten. The UI mirrors this (`isAcceptableEdit`).
- Registration shares the field: the draft description is validated when saved (rejected > 250) and copied to `organizations.description` when the draft is submitted (pgTAP D-19..D-21, browser DS-3). Registration steps and Coming Soon restrictions are untouched.
- Public visibility and moderation: **no change**. The description is visible to the organization's own members only and is in no public directory/catalog view (pgTAP D-17). No moderation rule exists for free-text descriptions today (only name changes are Admin-reviewed).

**Existing data above 250 characters.** Local database: **none** (longest bio 142, product 70, offer 16; drafts, onboarding, portfolio and referrals empty). **Production is unknown.** Run this read-only check before release; nothing is rewritten either way:

```sql
select 'profiles.bio' f, count(*) filter (where char_length(bio) > 250) over_250, max(char_length(bio)) longest from public.profiles
union all select 'products.short_description', count(*) filter (where char_length(short_description) > 250), max(char_length(short_description)) from public.products
union all select 'product_offers.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.product_offers
union all select 'portfolio_items.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.portfolio_items
union all select 'business_creation_drafts.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.business_creation_drafts
union all select 'business_onboarding.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.business_onboarding;
```

Known consequence for published content: a **product or offer** already longer than 250 keeps working (view, pause, archive, restore), but editing its details in the V2 product/offer form asks for a shorter description (the validators from `20261017090002` check the submitted text; this is existing behaviour, not new). The bio, portfolio and draft paths above accept an unchanged long value. No published content is hidden or altered.

**Not changed - not descriptions, or a decision for the user.** Product names, SKUs, technical specifications, RFQ/quotation notes (2000), reviewer/Admin reasons, review comments (1500), branch addresses (300), chat messages, follow-up and activity text. **Open decision:** `jobs.description` (2000), `projects.description` (2000) and `organization_referrals.description` (1000) are descriptions by name but long-form requirement/brief text; they stay at their current limits because forcing 250 would break working flows. Say if they should follow the 250 rule.

**Verification.** pgTAP `84_description_250_test.sql` (36 assertions): 250/251 for Latin, Arabic, emoji and CRLF; manager / member / other-organization manager / outsider / anon; no direct UPDATE; audit; registration copy; bio and portfolio; legacy unchanged / changed / shortened. Vitest `description-limit.test.ts` and `organization-description-field.test.tsx`. Browser `e2e/audit/v2-description.spec.ts`: DS-1 (owner: 250 saves and reloads, 251 blocked and not cut, emoji, line break, clear), DS-2 (staff read-only; staff and other-organization RPC refused 42501; no cross-organization read), DS-3 (registration wizard: 251 blocks Continue, 250 carries to the organization and not to the personal profile). Screenshots: `docs/frontend/screenshots/v2-reference-alignment/v2-release/desc0*`.

## 8. Remaining production blockers

All earlier blockers stand (`docs/operations/showroom-v2-release-plan.md`): the release is now **44** migrations; Admin review UI for identity/branch/co-owner requests; hosted validation of the quotation stale-version 40001 behaviour; untested order/project transitions, invitations and personal-profile saves; canonical route decision; visual approval. New: the profile-image bucket and its four storage policies must exist on the target project.

## 9. Roadmap continuity

Unchanged and not started: F2 / M4a frontend closeout, M4b independent full commerce, M5 product/offer audiences and units, M6 integrated regression, Milestone D (suppliers, craftsmen, Shared Purchase Request UI), Phase 9A (settings and profiles for the other account types), Phase 8 (business operations), Phase 9B (final mobile and QA). Not implemented: Dynamic Tags, matching, subscriptions, quotation credits, Admin Page Builder. The Admin UI workstream was not touched.
