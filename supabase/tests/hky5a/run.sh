#!/usr/bin/env bash
# HKY-5A database check: applies every migration to a throwaway PostgreSQL cluster, then runs the
# Hockey parity cases, the malformed-input cases and the role flow. See README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
WORK="${HKY5A_WORK:-$(mktemp -d /tmp/hky5a.XXXXXX)}"
PORT="${HKY5A_PORT:-55432}"
# initdb and postgres refuse to run as root; set PG_RUN_AS=postgres there.
RUN=()
if [ -n "${PG_RUN_AS:-}" ]; then RUN=(runuser -u "$PG_RUN_AS" --); fi

mkdir -p "$WORK"
chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== building cases with the Hockey commands"
(cd "$REPO" && HKY5A_CASES_OUT="$WORK/cases.json" pnpm exec vitest run src/lib/hockey/hky5aParityCases.test.ts >"$WORK/cases.log" 2>&1) \
  || { tail -20 "$WORK/cases.log"; exit 1; }
node "$HERE/gen_parity.mjs" "$WORK"
node "$HERE/gen_flow.mjs" "$WORK"

echo "== starting PostgreSQL in $WORK"
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >"$WORK/init.log"
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
P=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

echo "== applying migrations up to 071 into the template"
"${P[@]}" -c "create database base"
"${P[@]}" -d base -f "$HERE/bootstrap.sql" >/dev/null
for f in "$REPO"/supabase/migrations/*.sql; do
  case "$(basename "$f")" in 072_*|073_*) continue ;; esac
  "${P[@]}" -d base -f "$f" >"$WORK/apply.log" 2>&1 || { echo "FAIL $f"; tail -5 "$WORK/apply.log"; exit 1; }
done

for db in parity flow; do
  "${P[@]}" -c "create database $db template base"
  for f in "$REPO"/supabase/migrations/072_*.sql "$REPO"/supabase/migrations/073_*.sql; do
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

echo "HKY-5A database check passed"
