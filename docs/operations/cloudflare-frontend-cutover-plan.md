# Cloudflare frontend cutover plan (prepared 2026-10-20, not approved)

Moves `aladdindecore.com` from the Vercel frontend to the Cloudflare Worker built in [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md). **Nothing here has been done.** Every stage needs the owner's explicit approval, and no stage deletes or disables the Vercel project, its deployments or its environment variables: Vercel stays the rollback until final acceptance.

## Facts this plan rests on

- DNS for `aladdindecore.com` is on **Vercel nameservers** today. A Worker can serve a hostname only in a zone that is active on Cloudflare (Custom Domain or route). So the zone has to move to Cloudflare first. That is the only slow-to-undo step (nameserver changes take hours to propagate), so it is done alone and changes no traffic.
- Supabase auth cookies are host-only (no `Domain` attribute) and `SameSite=Lax`. Serving the same hostname from Cloudflare keeps every signed-in session; nobody is signed out by the switch.
- FastAPI stays on Vercel. The Worker forwards `/api/backend/*` to `BACKEND_ORIGIN`, so browsers keep calling the same origin.
- `media.aladdindecore.com` (media Worker, ADR-0018/0020) needs the same zone, so stage 1 also unblocks it.

## Stage 0: preconditions (all must be GO)

1. Isolated R2 acceptance on `aladdin-r2-acceptance` is GO (separate thread and report).
2. The `preview` Worker on workers.dev passes the full E2E and security suites against the acceptance project, including sign-in, sign-up with Turnstile, password recovery, Admin, Showroom, uploads, video and revocation.
3. The owner approves **Workers Paid ($5/month)**. Server-rendered pages need more than the Free plan's 10 ms CPU per request.
4. Performance on the preview is no worse than Vercel on the measured routes (see the performance report).

## Stage 1: move DNS to Cloudflare with no traffic change

1. Export every record from Vercel DNS: apex and `www`, all `MX`, `TXT` (SPF, DKIM, DMARC, domain verifications), `CAA`, and any other subdomains.
2. Add `aladdindecore.com` to Cloudflare (Free plan). Recreate every record **exactly**, all **DNS only (grey cloud)**, so the apex and `www` still point at Vercel. Make sure `CAA` (if present) allows Vercel's and Cloudflare's certificate authorities.
3. Add `backend.aladdindecore.com` → Vercel (DNS only) and attach it to the Vercel project. It becomes the FastAPI origin (`BACKEND_ORIGIN`) after the switch.
4. Compare the Cloudflare zone with the Vercel export record by record, then change the nameservers at the registrar.
5. Verify from several resolvers: site, email (send and receive), and verifications still work. Traffic still goes to Vercel.

**Rollback:** set the registrar back to Vercel's nameservers (records there are untouched). Propagation can take hours, which is why nothing else changes in this stage.

## Stage 2: production Worker on a test hostname

1. Production secrets and vars on `aladdin-frontend-production` (guide: [cloudflare-frontend.md](../guides/cloudflare-frontend.md)), built with Production `NEXT_PUBLIC_*` values.
2. Attach a **Custom Domain** `next.aladdindecore.com` to it. Add that hostname to Turnstile and to Supabase's allowed redirect URLs.
3. Run the read-only staging smoke and a manual pass (sign-in, Showroom, Admin) on `next.aladdindecore.com`. Its cookies are separate from the live site's.

**Rollback:** remove the Custom Domain. No user traffic is involved.

## Stage 3: switch traffic (owner approval at the time)

1. Lower nothing further: proxied hostnames switch at Cloudflare's edge immediately.
2. Attach Custom Domains `aladdindecore.com` and `www.aladdindecore.com` to `aladdin-frontend-production`. Cloudflare replaces the grey-cloud records that pointed at Vercel.
3. Watch for 60 minutes (below). Keep Vercel deployments and domains untouched.

**Rollback (minutes):** detach the two Custom Domains and restore the original grey-cloud records to Vercel (`A 76.76.21.21` for the apex, `CNAME cname.vercel-dns.com` for `www`, or whatever the stage 1 export showed). Sessions survive in both directions because the hostname does not change.

## Monitoring and failure criteria

Watch Workers Observability (status codes, exceptions, CPU), Supabase logs and API usage, Upstash command count, and the media Worker's analytics.

Roll back at once if any of these holds for 5 minutes:
- 5xx above 1% of requests, or any `exceededCpu` (error 1102) or `exceededMemory`;
- sign-in, sign-up, recovery or sign-out failing;
- Server Actions failing (Showroom product save, Admin decisions);
- `/api/backend/health` not 200;
- mobile LCP p75 worse than Vercel by more than 20%.

## After acceptance (separate approval)

Remove the frontend from Vercel only after a stable period the owner chooses. Keep FastAPI on Vercel until its own migration is decided (not before R2 is stable).
