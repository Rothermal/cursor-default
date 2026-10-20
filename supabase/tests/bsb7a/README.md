# BSB-7A Server Integration Harness

Runs migration 079 and its identity, authorization, publication and concurrency
checks against a **disposable real PostgreSQL 16 database**. No Supabase project,
PostgREST, Docker, `psql` or production credentials are required. This is not live
Supabase/RLS, two-device, mobile or PWA signoff.

## Prerequisites

- A dedicated local PostgreSQL 16 server with a role allowed to create/drop test
  databases. The runner refuses non-loopback hosts, creates a random `bsb7a_*`
  database, and drops only that database on completion/failure. It never starts or
  stops the server, changes the template, or applies SQL to a Supabase project.
- Node and the repository's pnpm dependencies.
- `pg@8.16.3` in an external or ignored tools directory. Set `PG_MODULE` to its
  absolute `node_modules/pg/lib/index.js` path; there is no tracked dependency on
  the developer's `qa.local/sql-probe` installation.

Example PowerShell setup from the repository root:

```powershell
npm install --prefix "$env:TEMP/statkeeper-bsb7a-deps" pg@8.16.3
$env:PG_MODULE = "$env:TEMP/statkeeper-bsb7a-deps/node_modules/pg/lib/index.js"
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55437'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'postgres'
# Set PGPASSWORD in the environment only if the disposable server requires it.
New-Item -ItemType Directory -Force qa.local | Out-Null
$env:BSB6A_CASES_OUT = Join-Path (Get-Location) 'qa.local/bsb7a-cases.json'
pnpm exec vitest run src/lib/baseball/bsb6aParityCases.test.ts
$env:BSB7A_CASES = $env:BSB6A_CASES_OUT
$env:BSB7A_BUILD_BASE = '1'
node supabase/tests/bsb7a/run.mjs
```

`BSB7A_BUILD_BASE=1` starts the new database from `template0`, runs the committed
`bsb6a/bootstrap.sql` auth stand-in and all migrations 001-078, seeds pre-079
historical publications, then applies 079. PostgreSQL roles, grants, row policies,
locks and transactions are real; `auth.uid()` is the committed test stand-in, not
Supabase JWT validation.

For faster repeat runs, supply an unchanged pre-079 database as a template:

```powershell
Remove-Item Env:BSB7A_BUILD_BASE -ErrorAction SilentlyContinue
$env:BSB7A_TEMPLATE = 'bsb7a_base'
node supabase/tests/bsb7a/run.mjs
```

The template must already contain the auth bootstrap and actual migrations
001-078, and no 079 objects. The runner checks that boundary. `DATABASE_URL` can
replace `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`; its host must
still be loopback. Never point this harness at a production server.

## Output And Coverage

Each run emits generated real-command fixture SQL and `result.json` under ignored
`qa.local/bsb7a_<random>/`; `BSB7A_OUT` overrides that output directory. The SQL is
built by `gen.mjs` from the BSB-6 engine cases, with fresh event/game identities.
The Node runner executes the assertions and creates independent connections for
races; the generated fixture SQL alone is not the complete test suite.

A passing run reports **30 check groups, 46 expected refusals and 8 concurrency
scenarios**. The race checks require observed `pg_blocking_pids` relationships,
then release the controlling transaction and check the result. They cover both
link/merge directions, both link/finalize directions, link/link, reopen/link, and
old/reviewed finalization while a merge commits between review and pin insertion.
The publication-pause trigger exists only in the disposable test database.

Other groups cover historical null bootstrap/anomaly refusal, complete frozen
pins, unchanged old wrappers/merge body, receipt replay/reuse, stale CAS, injected
Reopen-link rollback, guardian/account/team refusals, private grants, independent
capability failures, pinned membership, corrupt/missing pins, merge chains and
convergence, invalid lineage, sibling pager equality, tied keysets and outcomes.
See [the regression record](../../../docs/REGRESSION_BSB_7A_SERVER.md).

Focused source-contract checks:

```text
pnpm test src/lib/baseball/migration079.test.ts src/lib/baseball/migration078.test.ts src/lib/baseball/migration077.test.ts src/lib/hockey/migration075.test.ts --maxWorkers=2 --silent
```
