# Showroom and Installer provider authentication security decision

**Status:** Research; decision pending. PR #84 remains Draft and merge-blocked.
**Reviewed:** 2026-10-14. Prices and provider capabilities must be checked again before purchase or rollout.

## Purpose

Determine whether a practical lower-cost solution can enforce account-level password-attempt controls at the publicly reachable Supabase Auth boundary, including direct GoTrue requests and attacks distributed over many IP addresses. This report does not authorize an implementation, a paid plan, hosted configuration changes, or identity migration.

## Current decision and scope

The owner declined Team/Enterprise upgrades and declined permanently accepting the missing provider-level guarantee. Preserve existing application quotas, Turnstile, native provider protections, existing identities and sessions. Continue independent PR fixes and isolated tests; do not merge, deploy, or remove the worktree.

The current shared Installer/Showroom implementation converts the canonical phone into the existing deterministic internal email alias, authenticates through GoTrue, establishes standard SSR sessions, then checks account context. The alias is an identifier, not a secret. An attacker who knows a phone can construct it. A browser-visible project URL and public API key are also not access barriers. The application HMAC quota is useful only on requests that execute the application action.

## Threat model and required distinction

- A direct attacker calls `/auth/v1/token?grant_type=password` with the public key and internal alias, bypassing Next.js actions, their account quota, and application-only CAPTCHA.
- A distributed attacker stays below each IP quota while concentrating guesses on one identity, or sprays a small number of guesses across many identities. Per-account limits mitigate the first pattern; IP/global budgets, bot controls and detection are still needed for the second.
- Concurrent requests must consume an atomic shared account budget. Counting completed failures asynchronously can overshoot. Permanent account lockouts let anyone who knows an identifier deny service to its owner; recovery/unlock must be designed.
- Three different promises must not be conflated: limiting password comparisons before bcrypt, recording/rejecting failed attempts, and denying successful session issuance. A token hook can affect the last promise without meeting the first two.

## Verified provider behavior and evidence limits

The project organization was previously read as Free. The local diagnostic exhausted the application phone bucket, then a direct native request still returned `invalid_credentials` rather than application throttling. It did not obtain a session. This proves quota-path separation locally; it is not a hosted load test or a production configuration measurement.

Pinned GoTrue **v2.193.0** source applies the token limiter before password lookup, calls `Authenticate`, invokes the optional Password Verification Attempt hook, and returns early for an invalid password before issuing a token. No separate account failure counter appears in that password path. Consequently the paid hook can observe failed verification and reject authentication, but executes **after password comparison**, not before bcrypt. A strict pre-hash cost budget would still require another control. This source version describes the local runtime; the hosted runtime version is not established here. [Pinned password-grant source](https://raw.githubusercontent.com/supabase/auth/v2.193.0/internal/api/token.go).

The limiter keys on a trusted forwarded IP, or the configured rate-limit header, not the password account. CAPTCHA middleware runs on the native token route when enabled; an administrative authorization header bypasses CAPTCHA, so privileged credentials must remain server-only. [Pinned limiter/CAPTCHA middleware](https://raw.githubusercontent.com/supabase/auth/v2.193.0/internal/api/middleware.go), [native route wiring](https://raw.githubusercontent.com/supabase/auth/v2.193.0/internal/api/api.go).

The current documented token endpoint default is 150 requests per five minutes per IP, burst 30, covering password and other token grants. A setting historically named `rate_limit_token_refresh` must not be assumed to affect refresh alone. These are published defaults, **not verified hosted values**. Trusted IP forwarding requires explicit enablement and a modern secret key; legacy `anon`/`service_role` JWT keys are not supported for that forwarding feature. [Supabase rate-limit contract](https://supabase.com/docs/guides/auth/rate-limits).

Password Verification Attempt is documented for Team/Enterprise; Custom Access Token is available on Free/Pro. Pro therefore does not unlock the missing failed-password hook. Current published base prices are Free $0/month, Pro from $25/month and Team from $599/month, before applicable usage/add-ons. No upgrade was made. [Hook availability](https://supabase.com/docs/guides/auth/auth-hooks), [pricing](https://supabase.com/pricing).

## Options compared

| Option | Direct native requests and distributed guesses | Identity compatibility / complexity | Cost and decision |
|---|---|---|---|
| Keep Free; verify/tune native IP limits and native CAPTCHA | Native protections cover direct requests when enabled. CAPTCHA adds friction per attempt; distributed solvers/IPs can still target one account without an aggregate account budget. Does not satisfy the outstanding guarantee. | Existing users and SSR stay. Native CAPTCHA must be passed through every affected general, Installer and Showroom flow, including registration auto-login. Low/moderate change. | No plan upgrade; operational support and CAPTCHA integration costs remain. Useful defense in depth, not an approved substitute. |
| Free Custom Access Token hook | Can reject token issuance after valid credentials; cannot observe failed-password calls or limit their comparisons. An application-issued per-user permit can race with a direct attacker during its validity window unless strongly bound to the specific authentication request. | Hooks also run for token refresh and other methods; careless rules break existing sessions. A robust request-bound permit is not provided by the documented hook input. | No plan upgrade, but meaningful design/testing cost. Do not present as a solved account-attempt quota. |
| Audit-log monitor and temporary bans | Reactive; log delay and concurrent guesses prevent a strict synchronous ceiling. Can also permit attacker-triggered lockout. Failure event completeness must be verified. | Existing users preserved; monitoring, safe unlock, false-positive handling and retention required. | Potentially low infrastructure cost; not an acceptable replacement for synchronous enforcement. |
| Gateway/WAF in front of the application or a custom domain | Account budget works only if **all** password traffic must traverse it. A still-reachable `project-ref.supabase.co` origin bypasses it. CORS or hiding the URL does not stop non-browser clients. | Existing SDK/session paths need coverage, origin enforcement and trustworthy identity parsing. | Gateway cost alone buys no guarantee. Not recommended without a provider-supported, demonstrably exclusive origin restriction. |
| Team Password Verification Attempt hook | Provider receives account ID and validity for direct and proxied password calls. An atomic counter can enforce an account policy independent of attacker IP. Runs after comparison; cannot eliminate bcrypt work. | Preserves aliases, user UUIDs and sessions; requires fail-closed/availability policy and lockout recovery review. Lower architectural disruption. | From $599/month base; explicitly declined. Listed for comparison only. |
| Self-host the existing Supabase Auth implementation behind an exclusive gateway | Owning ingress permits a pre-auth account budget across IPs and private upstream; optional native hook can observe outcomes. Every password endpoint/alias and replica must share the atomic budget. | Significant operational and migration change; preserve UUIDs/password hashes/JWT trust and verify hosted data-service compatibility rather than assume drop-in replacement. No custom password verifier is proposed. | Hosting/DB/backups/monitoring/on-call costs, not a quoted fixed price. May be below Team's subscription but total cost is unproven. Requires separate architecture approval. |
| Move password authority to another established provider | Could satisfy the requirement only if its native boundary has an aggregate account policy across IPs and no old GoTrue password path remains usable. Marketing “brute-force protection” is insufficient evidence. | Credential/UUID mapping, sessions, recovery, consent, RLS, Storage and Realtime regression are substantial. One person must retain one application identity. | Obtain feature entitlement and realistic usage quote before recommending. Provider migration is explicitly unapproved. |

### Native CAPTCHA is a meaningful separate control

Supabase supports CAPTCHA on sign-in, signup and password reset. Application Turnstile verification alone does not enable native enforcement. A change would require explicit owner approval and all affected flows to pass the native CAPTCHA token. Cloudflare tokens are short-lived and single-use, so verifying the **same token twice**, first in application Siteverify and then at GoTrue, fails; do not silently remove current bot protection or reuse a consumed token. Design token ownership or obtain separate tokens, then test the complete flow. [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

### Why free hooks and monitoring do not close this blocker

The Custom Access Token hook receives user ID, claims and authentication method when a token is requested; it has no failed-password result or documented request-bound application nonce. Restricting issuance may prevent some bypass sessions, but failed guesses still reach GoTrue. Do not count successful token issuance as failed-attempt enforcement. [Hook input contract](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

Audit documentation describes asynchronous visibility. More importantly, the pinned password-grant source writes its `login` database audit entry after successful validation: a SQL trigger on that table is not a reliable failed-password counter merely because documentation calls `login` an attempt. Provider request logs may carry failures, but completeness, retention, latency and PII handling need separate checks. [Audit-log contract and delay](https://supabase.com/docs/guides/auth/audit-logs), [pinned source](https://raw.githubusercontent.com/supabase/auth/v2.193.0/internal/api/token.go).

Database network restrictions apply to Postgres/pooler and explicitly exclude HTTPS Auth APIs. They cannot make a hosted GoTrue origin private behind our gateway. No verified hosted Auth-origin allowlist was identified in this review. [Network restrictions limitations](https://supabase.com/docs/guides/platform/network-restrictions).

### Lower-cost architecture candidates requiring separate approval

Self-hosting transfers upgrades, security, availability, backups and operations to the owner. It is the closest candidate for retaining the existing authentication engine while owning the ingress boundary, but is a separate operational architecture rather than a small PR fix. A cost estimate must include recovery testing and staff time; no assertion that a cheap VM alone is safe or sufficient is made. [Supabase self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting), [Docker deployment guidance](https://supabase.com/docs/guides/self-hosting/docker).

Keycloak is a research candidate for an established provider: its brute-force protector retrieves login failures by realm/user ID and increments the user failure count, rather than using IP as the count's identity. Its documented temporary/permanent lockouts carry denial-of-service tradeoffs. Cluster consistency, concurrent overshoot and direct grant/browser flow coverage need a proof before selection. It is not an implemented replacement or a proven low-total-cost migration. [Keycloak configuration](https://www.keycloak.org/docs/26.6.4/server_admin/index.html#password-guess-brute-force-attacks), [pinned user-keyed protector source](https://raw.githubusercontent.com/keycloak/keycloak/26.6.4/services/src/main/java/org/keycloak/services/managers/DefaultBruteForceProtector.java).

Auth0 is supported as a Supabase third-party identity provider, but its current brute-force guide describes detection from a single IP, followed optionally by account-wide blocking. That does not prove a cross-IP aggregate threshold; require explicit documented configuration and multi-IP tests before treating it as a solution. Supabase third-party support does not migrate existing accounts and does not itself disable Supabase Auth. All old password paths must be deliberately retired as part of any future approved migration. [Auth0 protection semantics](https://auth0.com/docs/secure/attack-protection/brute-force-protection), [Supabase integration limits](https://supabase.com/docs/guides/auth/third-party/overview).

## Read-only hosted configuration review

### Dashboard observations, 2026-10-14

The PR #84 reviewer inspected the authenticated **aladdin-staging** dashboard (`kkpkgjrweysgvhvkhzun`) without changing or saving settings. Its organization displayed Free. The Rate Limits page showed sign-ups/sign-ins **30 requests per five minutes per IP**, refreshes **150 per five minutes per IP**, and OTP/token verifications **30 per five minutes per IP**. IP forwarding was off. The Attack Protection page showed native CAPTCHA off and leaked-password protection disabled. The Auth Hooks page showed no configured hooks. These are staging observations, not documentation defaults and not a production assessment.

The acceptance project's dashboard required a new login after navigation; its configuration remains unverified. No credentials were entered and no hosted authentication attempts, load tests, configuration changes or paid-plan changes were performed. The dashboard's branch label “Production” describes its default branch and does not independently establish that this staging project is the application's production database.

Native CAPTCHA being disabled means direct hosted GoTrue calls currently bypass application-only challenges. Enabling it needs separate approval and coordinated coverage of all affected authentication flows. Concurrent CAPTCHA changes found in the worktree are externally owned; this PR review neither edits nor commits them, and does not treat them as proof of hosted enforcement.

Check staging and acceptance independently; production has not been independently identified or assessed. Relevant known refs are staging `kkpkgjrweysgvhvkhzun` and acceptance `nxossqhdfltcqdwvbewi`. Do not infer that either represents production.

Use an authorized authenticated dashboard or **GET** `/v1/projects/{ref}/config/auth` with existing management access. This report documents the method; its author did not execute that management request. A service-role key is not a Management API personal access token. Do not print the response wholesale: it includes provider/CAPTCHA/SMTP secrets. Immediately project only these nonsecret fields, treating missing fields as unknown:

```text
rate_limit_token_refresh, rate_limit_verify, rate_limit_otp,
rate_limit_anonymous_users, password_min_length, password_hibp_enabled,
security_captcha_enabled, security_captcha_provider,
security_sb_forwarded_for_enabled, external_email_enabled,
external_phone_enabled, disable_signup, refresh_token_rotation_enabled,
security_refresh_token_reuse_interval,
hook_password_verification_attempt_enabled,
hook_custom_access_token_enabled
```

Use the current schema to confirm field names; capture project ref, observation time and method, not secrets. Unavailable management access means **unverified**, not disabled/default. Never use PATCH or CLI config push for this check. [Read Auth configuration API](https://supabase.com/docs/reference/api/v1-get-auth-service-config).

## Verification matrix before any solution can be accepted

| Check | Existing evidence / safe next verification |
|---|---|
| Application account quota is atomic, bounded and independent of IP | Existing application tests; retain regression for both account entry points. |
| Direct native wrong-password request after exhausted app bucket | Local diagnostic proved bypass. Preserve this as a failing coverage check until the architecture changes. |
| Hosted rate-limit/CAPTCHA flags and plan | Staging dashboard inspected: Free, signups/signins30/5min/IP, refresh150/5min/IP, verification30/5min/IP, native CAPTCHA/forwarding off, no hooks. Acceptance and production remain unverified; see observations above. |
| Native CAPTCHA missing/invalid/replayed token | Test on isolated local configuration or a separately approved test environment; confirm denial before credentials, successful login with fresh token, recovery/refresh compatibility. No hosted changes authorized. |
| Cross-IP, concurrent same-account attempts | Proposed solutions must cap aggregate attempts on every native route; use isolated synthetic users and trusted test ingress. Client-spoofed X-Forwarded-For is not proof of distinct source IPs. |
| New-account spray and resource exhaustion | Test IP/global limits and bounded account bucket storage as well as known-account thresholds. |
| Wrong password / unknown account / valid legacy password | Generic public errors; no new minimum on sign-in; no credential/token logs. |
| Correct password during attack and session refresh/logout | Document lockout policy, legitimate-user recovery, fail-closed outages and refresh treatment. Existing sessions must not be accidentally broken by a token hook. |
| Exclusive origin enforcement for gateway/self-hosting | Prove direct origin and alternative hostnames deny public password traffic; test IPv4/IPv6, direct token route and any password reauthentication route. |
| UUID, roles, RLS and cross-account compatibility | Both Installer and Showroom, general accounts, memberships, approval gates and cross-tenant denial must retain their existing authority. |

## Recommendation, deferred decisions and consequences

Keep PR #84 Draft. No researched option currently establishes the required guarantee on **unchanged hosted Supabase Free**. Continue read-only configuration verification and independent fixes; preserve existing controls without overstating their coverage.

The lowest-disruption route that observes failed attempts is the paid native hook, but the owner has declined it and it still runs after bcrypt. For a strict pre-verification account budget with lower subscription expense, the next decision should be whether to authorize a **separate, disposable architecture/cost proof** of an established Auth engine with exclusive ingress. Prefer evaluating self-hosted GoTrue compatibility first; compare an established user-keyed provider only if that option cannot meet operational requirements. This is a research recommendation, not authorization to build either.

Before choosing, the owner must approve the exact security promise (pre-hash budget versus failed-attempt policy/session denial), lockout/recovery behavior, operational ownership and budget. A weaker risk-based combination of native CAPTCHA, IP controls and monitoring would require explicit risk acceptance; that acceptance has not been given. No plan, identities, hosted configuration, deployment or architecture was changed by this research.

## Related files

- [Existing phone-auth decision](../decisions/ADR-0014-showroom-phone-password.md)
- [PR implementation and verification report](../frontend/showroom-business-onboarding.md)
- [Security model](security-model.md)
- [Architecture guide](../architecture/ARCHITECTURE_GUIDE.md)
