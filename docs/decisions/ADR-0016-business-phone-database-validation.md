# ADR-0016 — Authoritative business-phone numbering validation

Status: Accepted within the owner's PR84 blocker-resolution request, 2026-10-14. Deployment is not authorized.

## Purpose and current decision
Business contact writes must reject invalid country numbering patterns even through direct RPC/table calls. The database receives a private generated projection of the same pinned libphonenumber-js/max metadata used by the application. Validation covers calling-code selection, shared-code country resolution, national patterns, type-specific possible lengths and patterns. Canonical E.164 remains the storage contract; contact verification remains separate.

## Rationale and scope
Application-only checks cannot constrain authenticated direct RPC callers. A generated metadata projection avoids invented national regexes and does not require unrestricted service-role writes, a network dependency inside PostgreSQL or a new authentication backend. Protect both business_creation_drafts and organizations on contact-phone insert/change. Keep metadata private with RLS and no client/service-role table grants. A bounded stable helper is called by pinned-security-definer triggers.

Preserve the original business_draft_save/submit RPCs unchanged for currently deployed applications. New callers use explicitly versioned v2 names without overlapping overloads. Both interfaces use the existing transactional organization_create_owned engine. Old callers can still create pending businesses; incomplete required contacts/activity/address do not qualify a new business for approval/activation/selling. Version1 does not accept new contact fields and cannot bypass their database validation.

## Deferred and consequences
No shared migration history is rewritten: the four feature migrations were not present in either accessible shared project's migration history. Pending PR migrations may be corrected before their first deployment; previously applied main migrations remain untouched. Clean replay and original caller compatibility are required acceptance checks. After any future phone-library update, create a new forward migration updating the existing private metadata table, run cross-country parity tests, then deploy a compatible app. The current generator scaffolds the initial table snapshot; a later migration must adapt its generated rows to that existing table instead of recreating it. Never edit an already-applied metadata snapshot. Provider-boundary password throttling remains a separate decision and does not follow from phone validation.

## Related files
- [Feature report](../frontend/showroom-business-onboarding.md)
- [Original authentication decision](ADR-0014-showroom-phone-password.md)
- [Legacy selling decision](ADR-0015-showroom-address-selling-rollout.md)
- [Metadata generator](../../scripts/generate-business-phone-metadata.mjs)
