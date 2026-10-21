# Acceptance rebuild (owner chose "Rebuild", 2026-10-20)

Target: **aladdin-r2-acceptance `nxossqhdfltcqdwvbewi` only.** The script refuses any other linked project and never names staging.

## Why you run it, not Claude

This cloud environment cannot open a Postgres connection; the proxy allows HTTPS only. The only write path from here is the Supabase connector, which would mean re-typing 2.8 MB of migration SQL through it. That is slow and hard to keep byte-exact, and it can't produce a real `pg_dump` backup.

Running `rebuild-acceptance.sh` on your machine fixes all three problems:

- the backup is a real `pg_dump`;
- the CLI replays the committed files exactly;
- the database password never leaves your machine.

## Steps

1. Have Docker running. Run `pnpm exec supabase login` once in your aladdin checkout.
2. Run `bash /path/to/rebuild-acceptance.sh` from that checkout. The script:
   - pins PR #94 head `6894245` in a temporary worktree, so your checkout is untouched;
   - asks for the acceptance DB password with hidden input;
   - links the project and stops unless the linked ref is `nxossqhdfltcqdwvbewi`;
   - backs up to `~/aladdin-acceptance-backup-20261020/` (`roles.sql`, `schema.sql`, `data.sql`, migration list, `SHA256SUMS`; owner-only permissions) and stops if any backup file is empty;
   - runs `supabase db reset --linked --no-seed`, which drops app objects and replays all 179 migrations. The CLI asks you to confirm.
3. Reply in the thread when it finishes, or paste the last lines if it stops.

No seed data is loaded. The repo seeds include demo accounts, among them a platform administrator with passwords from the repo, which must never sit on an internet-reachable project.

## What Claude verifies afterwards (through the Supabase connector, read-mostly)

- The migration history equals the 179 branch versions.
- `schema-fingerprint.sql` hashes match `local-noseed-fingerprint.txt`, the same 179 migrations replayed locally without seed. A match means the hosted schema is what was tested. A mismatch is diffed by category.
- The Supabase security and performance advisors show no new findings.
- The Media Worker role is created and audited (`../media-edge-worker-role/`).
- The three old test sign-ins remain in `auth.users` without app rows. Claude removes them (they're kept in your backup) unless you say otherwise.

## Database tests

The full pgTAP suite (5,746 tests) needs the demo seed, so it ran **locally only**: it passes with the seed, and 20+ tests fail without it by design. On the hosted project, the schema-fingerprint match is the evidence that it is the tested schema.
