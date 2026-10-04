# HKY-5A database check

Runs migrations 072 and 073 against a throwaway PostgreSQL cluster and checks the Hockey
server contract recorded in `docs/REGRESSION_HKY_5_CLOUD_LIFECYCLE.md`. It never connects to
the Supabase project.

```sh
supabase/tests/hky5a/run.sh                      # as a normal user
PG_RUN_AS=postgres supabase/tests/hky5a/run.sh   # as root (initdb refuses root)
```

Needs PostgreSQL 16 server binaries (`initdb`, `pg_ctl`, `psql`; set `PG_BIN` if `pg_config`
is not on the path), Node and the repo's dependencies. `HKY5A_WORK` and `HKY5A_PORT` override
the work directory and port (default a new `/tmp/hky5a.*` directory and 55432). The script
exits non-zero on the first failed check.

What it does:

1. `src/lib/hockey/hky5aParityCases.test.ts` builds 15 games with the real Hockey commands,
   asserts the client's final score for each and, with `HKY5A_CASES_OUT` set, writes them to
   `cases.json`.
2. Starts a cluster, applies `bootstrap.sql` (stubs for Supabase's `auth` schema and roles)
   and every migration up to 071 into a template database, then applies 072 and 073 to two
   copies.
3. `gen_parity.mjs` loads each case as a cloud game and compares
   `validate_hockey_finalization_policy` with the client score; refused cases must stay
   refused.
4. `malformed.sql` copies parity games with one bad change each and checks each refusal
   message (and that two valid copies are accepted).
5. `gen_flow.mjs` runs the shootout early-clinch game as real team roles: bind, upload,
   checkpoint, readiness, finalize, refused writes after final, reopen, history, re-finalize,
   audit rows, and Baseball refused by the private cores.

The `auth` stubs read the user from `request.jwt.claim.sub` under `SET ROLE authenticated`, so
this covers the SQL, grants and row checks, not PostgREST or the deployed project.
