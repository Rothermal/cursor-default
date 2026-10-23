# BSB-7C1 Personal Settings SQL Checks

Runs migration 080 in a fresh, disposable **local PostgreSQL 16** database. It
never connects to a Supabase project or applies a live migration. PostgreSQL
grants, RLS, transactions and locks are real; `auth.uid()` is the committed auth
test stand-in, not live JWT/PostgREST verification.

## Run

Use a dedicated loopback PostgreSQL server whose admin may create/drop test
databases, plus `pg@8.16.3` in an external/ignored tools directory. The runner
refuses non-loopback hosts and drops only its randomly generated `bsb7c_*`
database, never the supplied template. It does not start or stop the server.

From the repository root in PowerShell:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55437'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'postgres'
$env:PG_MODULE = 'C:/path/to/tools/node_modules/pg/lib/index.js'
$env:BSB7C_CASES_OUT = Join-Path (Get-Location) 'qa.local/bsb7c-cases.json'
pnpm test src/lib/baseball/personalSettingsParity.test.ts --maxWorkers=2 --silent
$env:BSB7C_CASES = $env:BSB7C_CASES_OUT
$env:BSB7C_BUILD_BASE = '1'
node supabase/tests/bsb7c/run.mjs
```

The ignored `qa.local` directory must exist before exporting fixtures. Supply a
password through `PGPASSWORD` only if the disposable server needs one. No API key
is needed. `BSB7C_BUILD_BASE=1` bootstraps a new database with the auth stand-in and
actual migrations 001-079 before applying 080.

For faster repeats, omit `BSB7C_BUILD_BASE` and set `BSB7C_TEMPLATE` to an unchanged
database containing the auth bootstrap and migrations 001-078 (default
`bsb7a_base`). The runner applies 079 and 080 only in its disposable copy. Templates
must not already contain 079/080. See the [7A harness](../bsb7a/README.md).

## Coverage

A successful run reports **8 check groups, 127 expected refusals, 189 client/SQL
parity cases and 2 lock-observed concurrency cases**. It verifies:

- Active/authenticated account checks; explicit expected-account binding, own-row
  RLS, cross-account refusal, private-function and direct-write restrictions.
- Exact three-key personal payloads, immutable profile versions and the five
  approved overrides across all seven profiles, using the client-generated cases.
- Missing reads without writes, insert/update CAS, stale/missing-row conflicts,
  invalid-payload rollback and explicit transaction rollback.
- Concurrent initial inserts and same-revision updates. Each race requires an
  observed `pg_blocking_pids` relationship before committing the blocking writer.
- Byte-identical existing function bodies and unchanged settings row policies,
  Baseball release contract 2/078 and aggregate/link migration-079 capabilities.

This is not installed-PWA, physical-mobile, live Supabase or user-interface signoff.
See the [owning regression record](../../../docs/REGRESSION_BSB_7C_PERSONAL_SETTINGS.md).
