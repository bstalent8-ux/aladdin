#!/usr/bin/env bash
# Rebuild the Supabase ACCEPTANCE database (nxossqhdfltcqdwvbewi) from PR #94's migrations.
# Run on your own machine from a checkout of the aladdin repo. Needs: git, pnpm, Docker running,
# and `pnpm exec supabase login` done once. The database password is read silently into this
# process only; it is never echoed, written to disk, or sent anywhere except Supabase.
set -euo pipefail

REF="nxossqhdfltcqdwvbewi"                                 # aladdin-r2-acceptance ONLY
FORBIDDEN="kkpkgjrweysgvhvkhzun"                           # staging / live data: never
SHA="68942454426fd7ceea4a66b0e3303d9e67ba591a"             # PR #94 head, tested locally
BACKUP="${HOME}/aladdin-acceptance-backup-20261020"
sb() { pnpm exec supabase "$@"; }

[ "$REF" != "$FORBIDDEN" ] || { echo "refusing: forbidden ref"; exit 1; }
# Separate worktree, so your current checkout and uncommitted work are untouched.
git fetch -q origin claude/video-r2-2ibvgs
WT="$(mktemp -d)/aladdin-acceptance"
git worktree add -q --detach "$WT" "$SHA"
cd "$WT"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "wrong commit"; exit 1; }
[ "$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')" = "179" ] || { echo "expected 179 migrations"; exit 1; }
pnpm install --frozen-lockfile >/dev/null

read -r -s -p "Database password for aladdin-r2-acceptance (input hidden): " SUPABASE_DB_PASSWORD; echo
export SUPABASE_DB_PASSWORD

sb link --project-ref "$REF" >/dev/null
LINKED="$(cat supabase/.temp/project-ref)"
[ "$LINKED" = "$REF" ] || { echo "linked to $LINKED, not $REF: stopping"; exit 1; }
echo "Linked to $LINKED (acceptance)."

# 1. Backup (pg_dump via the CLI), kept outside the repo, readable only by you.
umask 077; mkdir -p "$BACKUP"
sb db dump --linked --role-only -f "$BACKUP/roles.sql"
sb db dump --linked -f "$BACKUP/schema.sql"
sb db dump --linked --data-only --use-copy -s public,app,auth,storage,supabase_migrations -f "$BACKUP/data.sql"
sb migration list --linked > "$BACKUP/migration-list-before.txt"
( cd "$BACKUP" && shasum -a 256 *.sql *.txt > SHA256SUMS )
for f in roles.sql schema.sql data.sql; do [ -s "$BACKUP/$f" ] || { echo "backup $f is empty: stopping"; exit 1; }; done
grep -q "media_storage_locations" "$BACKUP/schema.sql" || { echo "schema backup looks incomplete: stopping"; exit 1; }
echo "Backup written to $BACKUP"

# 2. Rebuild: drop app objects on the linked (acceptance) project and replay all 179 migrations. No seed data.
echo "About to reset $LINKED. The CLI will ask you to confirm."
sb db reset --linked --no-seed

# 3. Show the result for the report.
sb migration list --linked | tee "$BACKUP/migration-list-after.txt" | tail -5
echo "Done. Tell Claude in the thread; it verifies the rest through the Supabase connection."
echo "Afterwards you can remove the temporary checkout with: git worktree remove $WT"
