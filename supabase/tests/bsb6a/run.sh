#!/usr/bin/env bash
# BSB-6A database check: applies every migration to a throwaway PostgreSQL cluster, then runs the
# Baseball parity cases, the malformed-input cases, the role flow and Hockey's HKY-5A flow on the
# same schema. See README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
WORK="${BSB6A_WORK:-$(mktemp -d /tmp/bsb6a.XXXXXX)}"
PORT="${BSB6A_PORT:-55433}"
# initdb and postgres refuse to run as root; set PG_RUN_AS=postgres there.
RUN=()
if [ -n "${PG_RUN_AS:-}" ]; then RUN=(runuser -u "$PG_RUN_AS" --); fi

mkdir -p "$WORK/hockey"
chmod -R 777 "$WORK"
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== building cases with the Baseball and Hockey commands"
(cd "$REPO" && BSB6A_CASES_OUT="$WORK/cases.json" HKY5A_CASES_OUT="$WORK/hockey/cases.json" \
  pnpm exec vitest run src/lib/baseball/bsb6aParityCases.test.ts src/lib/hockey/hky5aParityCases.test.ts >"$WORK/cases.log" 2>&1) \
  || { tail -20 "$WORK/cases.log"; exit 1; }
node "$HERE/gen_parity.mjs" "$WORK"
node "$HERE/gen_flow.mjs" "$WORK"
node "$REPO/supabase/tests/hky5a/gen_flow.mjs" "$WORK/hockey"
# Hockey's flow pins its 073 handshake (074 moved it to contract 2) and checks that Baseball is
# refused; both lines stop applying once 074 and 077 are in, so they are left out here.
grep -v -e "get_hockey_release_capabilities" -e "baseball" "$WORK/hockey/flow.sql" >"$WORK/hockey_flow.sql"

echo "== starting PostgreSQL in $WORK"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >"$WORK/init.log"
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
P=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

echo "== applying migrations up to 075 into the template"
"${P[@]}" -c "create database base"
"${P[@]}" -d base -f "$HERE/bootstrap.sql" >/dev/null
for f in "$REPO"/supabase/migrations/*.sql; do
  [ "$((10#$(basename "$f" | cut -c1-3)))" -gt 75 ] && continue
  "${P[@]}" -d base -f "$f" >"$WORK/apply.log" 2>&1 || { echo "FAIL $f"; tail -5 "$WORK/apply.log"; exit 1; }
done

for db in parity flow hockey; do
  "${P[@]}" -c "create database $db template base"
  for f in "$REPO"/supabase/migrations/076_*.sql "$REPO"/supabase/migrations/077_*.sql; do
    "${P[@]}" -d "$db" -f "$f" >"$WORK/apply.log" 2>&1 || { echo "FAIL $f"; tail -5 "$WORK/apply.log"; exit 1; }
  done
done

echo "== parity"
"${P[@]}" -d parity -f "$WORK/parity.sql"
echo "== malformed inputs"
"${P[@]}" -d parity -f "$HERE/malformed.sql"
echo "== role flow"
"${P[@]}" -d flow -f "$WORK/flow.sql" >"$WORK/flow.log" 2>&1 || { tail -20 "$WORK/flow.log"; exit 1; }
grep -E "refused|^==" "$WORK/flow.log" | sed 's/^psql:[^ ]* NOTICE: */  /'
echo "== Hockey role flow after 077"
"${P[@]}" -d hockey -f "$WORK/hockey_flow.sql" >"$WORK/hockey_flow.log" 2>&1 || { tail -20 "$WORK/hockey_flow.log"; exit 1; }
echo "  Hockey flow passed ($(grep -c 'refused' "$WORK/hockey_flow.log") refusals as expected)"

echo "BSB-6A database check passed"
