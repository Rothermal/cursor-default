#!/usr/bin/env bash
# HKY-6B1 database check: applies every migration to a throwaway PostgreSQL cluster, binds,
# uploads and finalizes Hockey games from the HKY-5A cases, and reads the 075 aggregate pages as
# team roles. Never connects to the Supabase project. Same requirements as ../hky5a/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
WORK="${HKY6B1_WORK:-$(mktemp -d /tmp/hky6b1.XXXXXX)}"
PORT="${HKY6B1_PORT:-55434}"
RUN=()
if [ -n "${PG_RUN_AS:-}" ]; then RUN=(runuser -u "$PG_RUN_AS" --); fi

mkdir -p "$WORK"
chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== building the HKY-5A game cases with the client"
(cd "$REPO" && HKY5A_CASES_OUT="$WORK/cases.json" pnpm exec vitest run src/lib/hockey/hky5aParityCases.test.ts >"$WORK/cases.log" 2>&1) \
  || { tail -20 "$WORK/cases.log"; exit 1; }
node "$HERE/gen.mjs" "$WORK"

echo "== starting PostgreSQL in $WORK"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >"$WORK/init.log"
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
P=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

echo "== applying every migration"
"${P[@]}" -c "create database hky6b1"
"${P[@]}" -d hky6b1 -f "$REPO/supabase/tests/hky5a/bootstrap.sql" >/dev/null
for f in "$REPO"/supabase/migrations/*.sql; do
  "${P[@]}" -d hky6b1 -f "$f" >"$WORK/apply.log" 2>&1 || { echo "FAIL $f"; tail -5 "$WORK/apply.log"; exit 1; }
done

"${P[@]}" -d hky6b1 -f "$WORK/check.sql" >"$WORK/check.log" 2>&1 || { tail -30 "$WORK/check.log"; exit 1; }
grep -E "ok:|refused:|^==" "$WORK/check.log" | sed 's/^psql:[^ ]* NOTICE: */  /'
echo "HKY-6B1 database check passed"
