# ADR-0015 — Showroom address and selling rollout

Status: Accepted (product owner, 2026-10-14). Deployment is pending review.

## Purpose and current decision
Detailed address is optional during onboarding and mandatory before approval, activation and new Marketplace selling. New showrooms must also complete trading/legal names, business phone, activity and valid governorate/city. Completing these fields never grants approval by itself.

## Rationale and scope
Preserve existing approved active sellers without silently weakening the new-account contract. A forward migration captures the historical approved cohort and, for missing-address businesses only, the IDs of existing published products and orders. Private tables record the reason, policy and timestamp. Existing published products stay visible and captured orders may continue. New publication, new quotations and new orders require a valid address. No product is modified or unpublished by this migration.

Existing approved businesses retain their historical information contract; their cohort membership does not waive the address requirement for new selling. New registrations cannot enter the historical snapshot. Missing-address owners receive the existing business-profile completion item. Adding a valid primary-branch address closes the continuation exception with timestamp and actor; active showrooms subsequently cannot remove their valid address.

## What is deferred and consequences
Production impact assessment and deployment require separate review. Read-only staging found two affected businesses and six published products; staging is not evidence of production contents. Exceptions have no automatic expiry, avoiding unattended interruption of existing orders. Operations must track completion, review overdue cases and approve any suspension separately; do not extend the snapshot or reopen exceptions through client APIs.

Native Supabase password requests bypass the application's per-account throttling. This separate authentication limitation blocks merge/deployment and is documented in the feature report; this address decision does not resolve it.

## Related files
- [Feature report and remediation procedure](../frontend/showroom-business-onboarding.md)
- [Phone authentication decision](ADR-0014-showroom-phone-password.md)
- [Forward enforcement migration](../../supabase/migrations/20261014160000_showroom_activation_and_selling_address.sql)
- [Security regression tests](../../supabase/tests/92_showroom_seller_activation_test.sql)
