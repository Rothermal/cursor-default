#!/usr/bin/env bash
# HKY-5C database check: applies every migration to a throwaway PostgreSQL cluster, compares the
# server's Hockey settings validation with the client parser, and runs the save RPCs as team
# roles. Never connects to the Supabase project. Same requirements as ../hky5a/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
WORK="${HKY5C_WORK:-$(mktemp -d /tmp/hky5c.XXXXXX)}"
PORT="${HKY5C_PORT:-55433}"
RUN=()
if [ -n "${PG_RUN_AS:-}" ]; then RUN=(runuser -u "$PG_RUN_AS" --); fi

mkdir -p "$WORK"
chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== building the settings cases with the client parser"
(cd "$REPO" && HKY5C_CASES_OUT="$WORK/cases.json" pnpm exec vitest run src/lib/hockey/migration074.test.ts >"$WORK/cases.log" 2>&1) \
  || { tail -20 "$WORK/cases.log"; exit 1; }
node "$HERE/gen.mjs" "$WORK"

echo "== starting PostgreSQL in $WORK"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >"$WORK/init.log"
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
P=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

echo "== applying every migration"
"${P[@]}" -c "create database hky5c"
"${P[@]}" -d hky5c -f "$REPO/supabase/tests/hky5a/bootstrap.sql" >/dev/null
for f in "$REPO"/supabase/migrations/*.sql; do
  "${P[@]}" -d hky5c -f "$f" >"$WORK/apply.log" 2>&1 || { echo "FAIL $f"; tail -5 "$WORK/apply.log"; exit 1; }
done

"${P[@]}" -d hky5c -f "$WORK/check.sql" >"$WORK/check.log" 2>&1 || { tail -30 "$WORK/check.log"; exit 1; }
grep -E "refused|^==|passed| f$|\| f *$" "$WORK/check.log" | sed 's/^psql:[^ ]* NOTICE: */  /'
echo "HKY-5C database check passed"
