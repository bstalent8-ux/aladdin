# PR #84 functional release gate

Status: functional acceptance blocked by local Docker/API availability; no merge, deployment, hosted configuration change or risk acceptance authorized. PR remains Draft. Application candidate: `4e5bfdbdd5f247c325ecb19afe91000af3caf148`; subsequent local changes are task-owned test harness and documentation only. Seven external CAPTCHA files are excluded from acceptance and commits.

## Isolated acceptance evidence

Approved Compose project `aladdin_pr84_acceptance` uses fresh local credentials, independent database/storage volumes and internal network. Only its API gateway also joins its own ingress bridge to publish loopback port65521. Frontend3342 uses the existing worktree with a separate Next cache and generated TypeScript configuration. Hosted Supabase requests are refused by the launcher. No shared service or database was reset, restarted or reconciled.

All110 repository migrations and three synthetic seeds were applied to the fresh database. Recorded feature versions:20261014085731,20261014123000,20261014133000,20261014160000,20261014163431,20261014163435. Old save9argument/submit1argument contracts coexist with save_v2=13arguments/submit_v2=1argument. Focused database tests90–94:167passed,0failed. Existing candidate CI supplies92files/3847database tests twice,9058phone cases across245countries with0mismatches,2864frontend tests passed/13skipped, build/typecheck/lint, migration policy and concurrency checks.

Browser acceptance is **not complete**. After fixing unpublished gateway ports, an intermediate run passed desktop layout, password/consent, country selection, real Showroom registration/login/duplicate handling, application account throttling, payload cap and Installer signup (7 completed passes). Installer login reached home after its assertion deadline during cold compilation. A subsequent launcher working-directory correction ensured Tailwind discovers the project configuration and used a fresh independent cache. That final functional attempt recorded3passes (desktop layout, password/consent, country selection) and4failures (registration, cross-account/Installer case, throttle, payload test) before interruption: gateway/API requests stalled, and bounded Docker version/inspect/exec all returned ETIMEDOUT. The remaining17cases are not accepted. There is no completed24/24 current-head run, nor a verified complete onboarding/address/admin journey in this environment. Intermediate results do not establish final acceptance. No Docker daemon/shared service restart was attempted.

The gateway-only ingress bridge retains the private database network; DB port65522 was configured but not reachable through the internal bridge, so the executed database tests used docker exec rather than claiming host DB connectivity. Native CAPTCHA is off in this isolated baseline. Application CAPTCHA uses Cloudflare's published local test keys and a widget fixture while server Siteverify remains real. This does not verify production CAPTCHA, replay resistance or native CAPTCHA compatibility. Resume acceptance only after Docker is healthy, confirm the isolated manifest/ledger, remove any task-injected fixture trigger if present and use fresh synthetic phones; no shared reset is needed.

Local preview (not a hosted staging deployment):

Fresh independent read-only layout run after the corrected launcher:4passed/0failed (both routes, desktop1440x1000/mobile390x844, HTTP200, password control, no horizontal overflow or pageerror). All non-GET/HEAD/OPTIONS requests were blocked; this is visual acceptance only. Four refreshed screenshots and results are retained locally. Task-owned spec ESLint, frontend TypeScript and Git whitespace checks passed. The original14files and external7files retain their baseline hashes. No task changes were committed or pushed in this blocked acceptance session; PR head and its green checks remain unchanged.

- <http://127.0.0.1:3342/showroom/sign-in>
- <http://127.0.0.1:3342/showroom/sign-up>

No hosted staging preview is currently established for this release. Runtime manifests, migration logs, E2E JSON, screenshots and traces are under `D:/projects/pr84-acceptance-*`. Private local environment/configuration files must never be committed or attached. The healthy environment is retained; cleanup requires owner approval.

## Release choices

**A — recommended controlled beta, conditional on approval and gates.** Enforce beta eligibility on the server before account creation and sensitive access. A hidden URL or frontend restriction is insufficient. Current showroom approval/selling controls do not provide a signup eligibility allowlist. The eligibility mechanism is a separate implementation decision and is not currently shipped. It must reject ineligible authenticated identities, including identities created directly through GoTrue, before privileged onboarding/access; preserve existing Installer and approved showroom behavior; and have negative integration tests. Direct provider login remains outside application throttling even with an allowlist, so residual risks still require explicit acceptance.

**B — wider registration, not authorized.** Requires coordinated native CAPTCHA compatibility tests, verified hosted IP limits, operational alerting and explicit acceptance of distributed/direct-GoTrue risks, plus production-data assessment. The current implementation must not be presented as satisfying an aggregate account attempt limit across IPs.

Preserve application CAPTCHA, HMAC phone/IP budgets, generic login errors, secure sessions, server-selected roles, RLS, phone metadata and selling approval checks. Proposed Free controls: native Turnstile on password flows after coordinated token-contract tests; keep provider `/auth/v1/token`150requests/5minutes/IP with burst30 and verify/signup-family applicable limits until measured tuning is approved; keep application login30/IP and10/phone per15minutes, signup10/IP and5/phone per15minutes. Do not enable trusted forwarded IPs without validating the ingress trust boundary. Monitoring must use sanitized outcomes/counters, never passwords, tokens, request bodies or raw phone numbers. Validate visibility of direct provider failures before relying on alerts. No hosted setting is changed by this proposal.

These controls **do not guarantee an aggregate per-account attempt limit across IPs**. CAPTCHA solving, credential stuffing from distributed IPs, account-targeted denial of service and incomplete provider log visibility remain risks. No Supabase Team upgrade or provider migration is approved. For a strict guarantee, commission a separate synthetic proof of exclusive GoTrue ingress plus atomic account budgets, explicitly testing bypass closure and existing JWT/identity/RLS compatibility before any architecture decision.

## Production prerequisites and deployment checklist

1. Owner confirms the production Supabase project reference. The live domain maps to Vercel `aladdin-staging` with a production deployment target; that name is not evidence of the database identity. Accessible staging `kkpkgjrweysgvhvkhzun` and acceptance `nxossqhdfltcqdwvbewi` must not be assumed production.
2. Read-only production migration inventory, Auth/CAPTCHA settings, schema drift and affected-showroom/product/order counts. Staging has two active verified showrooms missing addresses, six published products and three orders; production impact is unknown. Stage IDs: `9c000000-cccc-4ccc-8ccc-000000000001` and `91000005-1111-4111-8111-000000000005`. Do not disclose customer data or automatically deactivate/unpublish anything.
3. Approve chosen gate and coordinated CAPTCHA ownership. Preserve seven external files; no duplicate CAPTCHA implementation. Native CAPTCHA test must cover Installer, Showroom, SSR sessions and automatic post-registration login/token consumption.
4. Verify backup availability and perform restore rehearsal in disposable infrastructure. Assign deploy/rollback owners and maintenance window. Never rely on an untested backup or assume Free includes the required recovery facility.
5. Apply ordered additive migrations only after approval and against the verified target. Old RPC contracts remain during expand/contract; deploy application only after v2 is present. Run isolated hosted staging smoke/E2E before production. Do not drop old contracts in this release.
6. Roll back application to the prior known-good deployment first while retaining additive schema/contracts. Database rollback is a separate reviewed recovery operation; do not blindly drop guards, metadata or legacy audit snapshots or reset production. Rehearse old-application compatibility and examine any newly written data before restoring a backup.
7. Post-release verify login/onboarding, session/role isolation, incomplete-address approval denial, new publishing denial, and continued eligible legacy products/orders. Observe sanitized errors/429s and rollback on critical access-control regression.

Planning estimate: after target identification, gate implementation, CAPTCHA coordination, backup rehearsal and explicit release approval, budget1–2engineering days for an isolated staging validation and controlled beta rollout. This is an estimate, not a guaranteed date; prerequisites are currently open. Wider launch and strict account throttling need separate scope estimates.

## Security follow-up roadmap

| Priority | Proposed accountable owner | Acceptance criterion |
|---|---|---|
| Release blocker | Release owner + backend | Production identity/data impact, beta eligibility or wider-launch risk decision, backup/restore and staging acceptance approved |
| High | Auth/security owner + CAPTCHA task | Native/app challenge contracts pass Installer/Showroom/signup-autologin/session tests; hosted settings verified without secret exposure |
| High | Auth/security owner | Direct GoTrue/distributed attack threat model and explicit residual-risk acceptance, or synthetic exclusive-ingress proof closes every bypass |
| High | Operations owner | Sanitized provider/app failure and429 dashboards, alert delivery rehearsal, retention/access controls; direct-provider visibility gaps documented |
| High | Security owner | Independent tenant/role/approval penetration tests; unauthorized access, escalation or sensitive exposure blocks release immediately |
| Medium | Support/security owner | Recovery and incident-response runbooks rehearsed with synthetic accounts; no insecure phone-ownership assumptions |

Owners are proposed roles, not confirmed assignments. Owner approval is required before release and before changes to hosted settings, architecture or paid services.
