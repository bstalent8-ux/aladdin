# M4 - Independent publishers: ownership impact assessment

Status: **assessment only. No ownership schema has been changed.** M4 implementation waits for review of this document.

Approved behaviour: an independent Contractor or Engineer may publish products and commercial Product Offers under
their own professional identity **only after Admin approval**. No fake organization is created. One item has one
authoritative seller identity that client input cannot reassign. Contractor / Engineer registration stays Coming Soon
until M4 is implemented, the approval flow is built, integration and browser tests pass and the owner explicitly
opens the routes.

## 1. What ownership looks like today (verified against the isolated database)

Everything commercial is owned by an **organization**, never by a person.

| Area | Current ownership | Notes |
|---|---|---|
| `products` | `organization_id NOT NULL`, `created_by` (authorship only) | status draft/published, `version`, `deleted_at`, `archived_at` |
| `product_prices`, `product_images`, `product_audiences` | `organization_id` (denormalised) | images: object key `"{organization_id}/{product_id}/{uuid}.ext"` in the `product-images` bucket |
| `product_offers`, `product_offer_items`, `product_offer_audiences` | `organization_id` | package validity checks that every item belongs to the same organization |
| `saved_products` | **saver's** `organization_id` (the buyer) | buyer-side, unaffected by who sells |
| Direct RFQ | `rfqs.requester_org_id` / `supplier_org_id` | `quotations`, `orders`, `conversations` carry the same pair |
| Shared Purchase Request | `purchase_requests.requester_org_id`, `purchase_request_responses.responder_org_id` | responder is an organization today |
| Notifications / points | `notifications.organization_id`, `points_ledger.organization_id` | org-addressed (`app.notify_org`) |
| Projects | `projects.requester_org_id` / `executing_org_id` | |

Authority is `app.has_capability(org, ...)` (membership + capability rows), seller capability is gated by
`app.org_is_approved(org)`, audience is `app.org_product_audience(org)` derived from `org_type`.

### Objects that name the owner (the change surface)
- **42 functions** (a source scan; two of them only incidentally) read or write product / offer / image / saved / audience tables (list in section 6).
- **10 table policies** (`products_select_own`, `product_offers_select_own`, `product_images_select_org`,
  `product_prices_select_own`, `product_audiences_select_own`, `product_offer_audiences_select_own`,
  `product_offer_items_select_own`, `saved_products_select_own_org`, plus the two platform policies) and **4 storage
  policies** (`product_images_insert_authorized`, `_select_org`, `_delete_writer`, `_select_public`).
- Views `own_product_offers`, the catalog views (`supplier_name`, `supplier_slug`, `supplier_verified`).
- **17 frontend files** call the product / offer / image RPCs (`own-products.ts`, `offers.ts`, `commerce*.ts`,
  `product-images.ts`, `showroom-home.ts`, `directory.ts`, `search.ts`, the product form, image manager, audience
  picker and publish toggle), plus the workspace / context loader and the Showroom suite shell.

## 2. Proposed ownership model

### Decision: a `publishers` identity table, not a personal organization and not a second nullable owner column

```
publishers
  id               uuid pk
  kind             'organization' | 'independent_contractor' | 'independent_engineer'
  organization_id  uuid null unique  -- set iff kind = 'organization'
  user_id          uuid null unique  -- set iff kind = independent_*
  status           'active' | 'suspended' | 'revoked'
  approval_id      uuid null -> verifications(id)   -- the Admin approval that created/activated it
  approved_by, approved_at, revoked_by, revoked_at, revoked_reason
  check ((organization_id is null) <> (user_id is null))
  check (kind = 'organization') = (organization_id is not null)
```

* **A. Organizational publisher**: one row per organization, created and kept in sync by the organization approval
  path (`app._apply_org_approval`). `status` mirrors `app.org_is_approved`.
* **B/C. Independent Contractor / Engineer publisher**: created **only** by the approval of a new verification type
  `independent_publisher` (subject `user`, persona contractor/engineer; same Admin queue and same review RPCs). The
  user's persona decides the kind; it cannot be supplied by the client.
* `products`, `product_offers` (and the child / image / price rows) gain `publisher_id NOT NULL` (immutable trigger).
  `organization_id` stays for organizational items and becomes nullable, with
  `check ((organization_id is not null) = (kind of publisher_id = 'organization'))` enforced by trigger.
  `created_by` remains authorship, never ownership.
* **One authoritative identity:** every create RPC takes the *acting identity* as a parameter
  (`p_publisher_id`) but never trusts it: `app.can_act_as_publisher(publisher_id)` re-derives authority
  (organization -> membership + `catalog.write`/`catalog.publish` + `org_is_approved`; independent ->
  `publishers.user_id = auth.uid()` and `status = 'active'`). After insert the column is immutable; there is no
  "move product" RPC. Updating a product never accepts a new publisher.
* **Why not alternatives:** (a) a fake personal organization is rejected by the decision and would inherit org
  semantics (memberships, branches, applications); (b) `owner_user_id` on every table duplicates a second ownership
  concept into ~10 tables and ~42 functions without a place to hang approval/revocation state.

### Audience for an independent publisher
Audience resolution stays derived, never stored: `app.publisher_audience(publisher)` returns the organization's
`org_product_audience` for kind `organization`, and `contractor` / `engineer` for the independent kinds. Visibility
predicates (`product_visible_to`, `offer_visible_to`, `product_image_viewable`, `offer_is_live`) take the
publisher and require `publisher.status = 'active'` in place of `org_is_approved(org)`. Nothing aggregates audiences
across a person's publisher identities or organizations.

### Active identity in the UI
A user can be an independent publisher **and** a member of organizations. The workspace switcher gains one extra
entry "Independent professional" only when an active independent `publishers` row exists (derived, like workspaces;
no table of workspaces, no persona switching). The active entry decides the `p_publisher_id` the screens send; the
database re-checks it.

## 3. Behaviour: authorize, query, sign, edit, publish, unpublish, moderate

| Operation | Organizational | Independent |
|---|---|---|
| Create / edit / archive | membership + `catalog.write`, org approved | `publishers.user_id = auth.uid()`, publisher active |
| Publish / unpublish | `catalog.publish`, org approved | owner, publisher active; **publishing is refused unless active** |
| Read own (RLS) | `is_org_member` + capability | `user_id = auth.uid()` |
| Catalog / search / offers feed | seller visibility via org approval + audience | via publisher status + persona audience |
| Image upload / read / sign | key prefix `{org}/...` + `can_write_catalog(org)` | key prefix `p/{publisher_id}/...`; same grant model (30-min grant, **revalidated live on every use**, 5-min signed URL) |
| Private product price | shown only to eligible audiences, unchanged | unchanged |
| Admin moderation | existing platform policies | same; moderation acts on the publisher (suspend/revoke) |

## 4. Revocation

Independent approval is revocable (new `publisher_revoke(publisher, reason)`, Admin only, audited, mirrors
`org_co_owner_revoke`). On revoke/suspend, **content is hidden, not deleted**: every visibility predicate requires an
active publisher, so published products and live offers stop appearing in catalog, search, offers feed, saved lists
and signed image access immediately (a signed URL already issued lives at most 5 minutes - the existing bound);
drafts remain editable by the owner; archived history stays; reinstatement (a new approval) restores them. Open
RFQs / quotations / orders created before revocation keep their historical records and remain readable by both
parties; new RFQs against a revoked publisher are refused. A user who is also an organization member is unaffected on
the organizational side.

## 5. What does NOT change in M4 (and what needs a decision)

* Organization-owned products and offers remain valid: the migration backfills one `organization` publisher per
  organization and sets `publisher_id` on every existing row; org behaviour is identical.
* **Decision needed - M4 scope split.** Direct RFQ, quotation, order, conversation and project rows address a
  *supplier organization*. Supporting an independent seller end to end touches those (`supplier_org_id` ->
  `supplier_publisher_id`, notifications, chat, points, Shared Purchase Request responder identity and the future
  individual quotation-credit owner). Recommendation: **M4a** = identity, approval, products, offers, images,
  catalog/search/feed, revocation, tests; **M4b** = Direct RFQ / quotation / order / chat for independent sellers,
  with independent items showing a clear "Not available for requests yet" state in M4a rather than a broken action.
  Registration must not open until M4b is decided (a Contractor/Engineer who can publish but not be requested is an
  incomplete product).
* Shared Purchase Request visibility matrix, Direct RFQ vs Shared Request authorization, referral and Points
  behaviour are untouched in M4a.

## 6. Every RPC, policy and component to change (M4a)

**Functions (rewrite the owner check; signatures gain `p_publisher_id` where a creator):**
`own_product_create`, `own_product_update`, `own_product_set_archived`, `set_product_published`,
`product_audiences_set`, `product_image_request_upload`, `product_image_confirm_upload`, `product_image_remove`,
`product_image_reorder`, `product_image_access_grant`, `own_offer_save`, `own_offer_set_status`, `catalog_products`,
`catalog_product_images`, `offers_feed`, `offers_feed_page`, `offer_set_saved`, `saved_products_for`,
`save_product`, `unsave_product`, `create_product`, `update_product`, `showroom_home_metrics`; helpers
`app.product_visible_to`, `app.offer_visible_to`, `app.offer_is_live`, `app.offer_public_json`,
`app.offer_validate_package`, `app.own_product_validate`, `app.product_image_viewable`,
`app.can_read/upload/delete_product_image_object`, `app.has_product_image_grant`, `app.is_public_product_image_object`,
`app.product_is_public`, `app._catalog_supplier_identity`, `app.product_images_enforce_max`, `app.offer_is_saved`.
**New:** `publishers` table + RLS, `app.publisher_is_active`, `app.can_act_as_publisher`, `app.publisher_audience`,
`independent_publisher_request`, `publisher_revoke`, `my_publishers`, dispatcher branch in `app._apply_org_approval`
(or a user-subject sibling), audit actions, verification type `independent_publisher` and its constraint / unique
indexes.
**Policies:** the 10 table policies and 4 storage policies above gain an independent branch; **views:**
`own_product_offers` and the catalog views expose the publisher display name / slug instead of an org-only join.
**Frontend:** the 17 files above, the workspace loader (`loadWorkspaces`), the switcher and Showroom-suite menu (new
"Independent professional" entry), the Create/Edit Product and Offer forms (acting-publisher context), the Admin
verification label map, `database.types.ts`, i18n en/ar.

## 7. Migration and rollback strategy (expand -> contract)

1. **Migration 1 (additive, reversible):** enum values; `publishers`; backfill one organization publisher per
   organization (idempotent, keyed on `organization_id`); add nullable `publisher_id` to the ownership tables;
   backfill `publisher_id` from `organization_id`; add FK + `NOT NULL` + immutability trigger + consistency trigger.
   No behaviour change yet (`organization_id` still authoritative).
2. **Migration 2:** new helpers and the approval/revocation RPCs; re-create product / offer / image / catalog functions
   and the storage helpers to authorize through `publisher_id` (organizations produce identical answers - proven by
   running the full existing pgTAP suite unchanged).
3. **Migration 3:** policies and views switch to the publisher predicates.
4. **Frontend** ships behind the unchanged Coming Soon registration gate; the independent entry appears only for an
   active independent publisher row, which only an Admin approval can create.
5. **Contract (later, optional):** drop redundant `organization_id` copies only after a full release cycle.

**Rollback:** every migration only adds objects or re-creates functions/policies. Reverting = re-applying the previous
function/policy definitions (kept in the previous migration files) and leaving the additive columns/tables in place
(harmless). Backfills are idempotent. Kill-switch without a deploy: `update publishers set status = 'suspended'
where kind <> 'organization'` hides all independent content instantly. No production data is touched (isolated
`aladdin_sr2` only until approved).

## 8. Security risks and mitigations

| Risk | Mitigation |
|---|---|
| Client reassigns an item to another seller | `publisher_id` immutable by trigger; no move RPC; creates re-derive authority server-side |
| IDOR on `publisher_id` / storage prefix | `can_act_as_publisher` on every write; storage helpers resolve through `product_images.publisher_id`, never the path alone |
| Self-granted independent status | only the approval of an `independent_publisher` verification (platform reviewer, not the subject) creates an active row; clients have no write privilege |
| Persona forged to get an audience / kind | kind derived from the persona at approval; audience derived, never stored |
| Org member vs independent identity mix-up | explicit active identity; database checks the identity, not the screen; audiences never aggregated |
| Revocation leakage | live predicates; signed URLs <= 5 minutes; grants re-validated on use |
| Duplicate seller after leaving an org | `created_by` is authorship only; org content stays with the org |
| Admin bypass / double approval | reuse the existing review RPCs and the atomic trigger (same proof as M1/M3) |
| Check-then-act races | reuse `app._lock_org_actor`-style share locks on the publisher row |

## 9. Test matrix (to build with M4a)

pgTAP: create/edit/publish by approved independent; refused when not approved / suspended / revoked; cannot act as
another publisher or organization; cannot reassign; org items unchanged (existing suites 68-75 unchanged and green);
audiences per kind; visibility hides on revoke and returns on reinstatement; images grant/sign/deny incl. revocation;
offers package must be one publisher; saved products; moderation; audit rows; two-session concurrency (revoke vs
publish). Vitest: forms send the acting identity, switcher entry only when active, Arabic/English. Playwright small
batches: apply -> pending -> Admin approves (real RPC) -> publish product and offer -> buyer sees (audience) -> Admin
revokes -> hidden -> signed URL denied; Light/Dark, 390px, RTL.

## 10. Readiness

Ready to implement M4a **after** the owner confirms: (1) the `publishers` model; (2) the M4a / M4b scope split;
(3) that independent items show "not available for requests yet" until M4b; (4) whether a Contractor/Engineer who is
*also* an organization member may keep both identities (recommended: yes, explicit switcher entry). Registration stays
Coming Soon throughout.
