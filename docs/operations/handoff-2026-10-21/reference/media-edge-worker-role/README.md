# Media Worker database role (acceptance only)

For Supabase **aladdin-r2-acceptance** (`nxossqhdfltcqdwvbewi`) only. Do not run this on staging/Production (`kkpkgjrweysgvhvkhzun`).
No password appears in any file here, and none goes into migrations, GitHub or chat.

## Files

- `01-create-role.sql` creates `media_edge_worker`. Run it after the acceptance migrations (needs `20261019100000_media_edge_authorization`). It refuses to run if `media_edge` is missing or the role already exists.
- `02-verify-role.sql` is a read-only privilege audit. Every row must say `ok`.
- `03-behaviour-test.sql` runs reads/writes/DDL on user, organization, media, auth and storage data, which must all be denied, and checks that the three authority functions still answer.

## What the role can do

- It is a `LOGIN` role that is `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`, with a limit of 20 connections.
- Its only membership is `media_edge` (NOLOGIN, from the migration). That gives it EXECUTE on exactly `public.media_edge_authorize`, `public.media_edge_public` and `public.media_edge_video`, and USAGE on schema `public`. It has no table grants and no `app`/`auth`/`storage` access.
- Role defaults:
  - `statement_timeout 3s`
  - `idle_in_transaction_session_timeout 5s`
  - `lock_timeout 1s`
  - `default_transaction_read_only on` (the functions never write)
  - `search_path ''`
- The functions restore the caller's JWT claims before returning, so forging `request.jwt.claims` on the connection does not impersonate anyone. The pgTAP test `99_media_edge_authorization_test.sql` covers this.

## Local results (2026-10-20, local Supabase with all 179 branch migrations; a simulation, not the provider)

- `02`: all checks passed except one, which is local-only. The local image ships `pg_net` with PUBLIC `USAGE` and DML on `net.http_request_queue`, so the role (like every role there) could queue outbound HTTP after `set transaction read write`. **On acceptance `pg_net` is not installed and `public` is the only schema with PUBLIC usage (checked).** If `pg_net` is ever enabled there, revoke it from PUBLIC first.
- `03`, logged in as `media_edge_worker` over TCP: all 15 statements were denied, and all three functions answered with a denial for unknown viewers.
- The Worker suite passed 42/42, including the live authority test with the real `postgres.js` driver: allow, then deny on the same ticket after sign-out, unpublish and delete. I re-ran it with a role carrying exactly these hardened settings and it passed.

## Setting the password (owner, from your own machine)

1. Generate a random password of 32+ characters in your password manager.
2. Connect as `postgres` through the **Session pooler** string from the acceptance project's Connect dialog, then run `\password media_edge_worker` in `psql`. psql hashes it (SCRAM) on your machine, so the plain text never reaches the server, its logs or the SQL editor history. Don't use `alter role ... password '...'` in the SQL editor.

## Entering it into Hyperdrive (owner, Cloudflare dashboard)

Go to Storage & databases → Hyperdrive → Create configuration and enter:

- Name: `aladdin-media-edge-acceptance`
- Host: the acceptance **Session pooler** host shown in Supabase Connect (`aws-…-eu-west-1.pooler.supabase.com`)
- Port: `5432`
- Database: `postgres`
- User: `media_edge_worker.nxossqhdfltcqdwvbewi`
- Password: paste it from the password manager

Then:

- **Disable caching.** A cached answer would delay revocation.
- Set max connections to the minimum (5).
- Keep TLS required.

Hyperdrive tests the login when you save. Send back only the configuration **ID**, which is not a secret.

## Direct connection vs IPv6

- On the Free plan, the direct host `db.nxossqhdfltcqdwvbewi.supabase.co:5432` is **IPv6 only**. IPv4 needs the paid IPv4 add-on, which is off-limits.
- The Cloudflare Hyperdrive docs I searched don't state whether Hyperdrive can reach an IPv6-only origin. So the direct connection is **unverified**, and this sandbox can't test it either (no raw TCP out).
- **Recommended:** the Session pooler on port 5432. It's IPv4 on every tier, supports custom roles as `role.projectref`, and keeps prepared statements working, which postgres.js needs behind Hyperdrive.
- **Don't use the Transaction pooler (6543).** It breaks prepared statements, and Hyperdrive already does transaction pooling.
- If you want to try the direct host anyway, create the config with it first. If Hyperdrive's save-time connection check fails, switch to the Session pooler; nothing else changes.
- Session-mode connections count against the project's pooler pool size. Five Hyperdrive connections fit within the Free defaults.

## After the acceptance migrations (my part)

1. Run `01` through the Supabase connection on `nxossqhdfltcqdwvbewi`.
2. Run `02`.
3. Run `03` after `set role media_edge` (same privileges; the connection logs in as `postgres`).
4. Once the Worker is deployed, check real connectivity through Hyperdrive from the Worker (the only path that can reach the database), plus allow/deny/revocation against real R2 objects.
