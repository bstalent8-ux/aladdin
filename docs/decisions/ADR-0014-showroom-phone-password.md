# ADR-0014 — Temporary Showroom phone/password entry

**Status:** Accepted · 2026-10-14 · explicitly requested by the product owner.

## Purpose and current decision

Expose `/showroom/sign-in` and `/showroom/sign-up` using the existing Installer Supabase password infrastructure. One person still has one identity and one globally unique canonical phone. Keep the existing internal alias domain unchanged across phone accounts; its historical craftsman name is not a role claim. Do not implement OTP or OAuth.

## Rationale and scope

Share registration initialization, rollback, password rules, phone parsing, sessions and throttling. Server-selected Showroom registration records `business/showroom_dealer` intent only, then enters the existing mandatory business onboarding. It creates no organization, membership, capability, approval or verified phone. Confirming an internal alias enables the existing caller gate; it does not verify a contact channel.

Both phone entry points check the caller's database account context after authentication. A Showroom entry requires eligible first-business intent or an active Showroom membership. Installer entry requires the established Installer persona. Neither entry can grant the other account's permissions. Business operations retain their existing RLS and capability checks.

Shared durable rate limits run before credential work, by trusted proxy IP and canonical phone, with service-role-only consumption. Hash limiter identifiers with a server secret; fail closed on unavailable limiter storage. Bound form size before parsing and password size before authentication. Preserve valid legacy passwords below the new-password minimum.

## UI decision

The supplied four screenshots authorize the cream/navy/sand/terracotta Showroom auth composition. Reuse the already approved scoped four-color theme and actual project brand assets. Preserve originals and README verbatim. Extract only the photograph for the hero, never an entire screenshot as a functional interface. This scoped exception does not restyle other routes.

## Deferred and consequences

Phone recovery remains absent until a verified recovery channel exists. OAuth and contact verification are separate work. The additive migration must precede application rollout; no production deployment is authorized. Phone identifiers remain locked to their internal login alias at the database boundary. Cleanup of the single temporary worktree occurs only after verified PR merge and a clean worktree.

## Related files

- [Installer authentication](../frontend/installer-phone-auth.md)
- [Identity model](ADR-0007-identity-and-tenancy-model.md)
- [Product direction](../product/PRODUCT_DIRECTION_GUIDE.md)
