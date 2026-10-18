# BSB-6A database check

Runs migrations 076 and 077 against a throwaway PostgreSQL cluster and checks the Baseball
server contract recorded in `docs/REGRESSION_BSB_6_CLOUD_LIFECYCLE.md`. It never connects to
the Supabase project.

```sh
supabase/tests/bsb6a/run.sh                      # as a normal user
PG_RUN_AS=postgres supabase/tests/bsb6a/run.sh   # as root (initdb refuses root)
```

Needs PostgreSQL 16 server binaries (`initdb`, `pg_ctl`, `psql`; set `PG_BIN` if `pg_config`
is not on the path), Node and the repo's dependencies. `BSB6A_WORK` and `BSB6A_PORT` override
the work directory and port (default a new `/tmp/bsb6a.*` directory and 55433). The script
exits non-zero on the first failed check.

What it does:

1. `src/lib/baseball/bsb6aParityCases.test.ts` builds 24 games with the real Baseball
   commands, asserts the client's score for each and, with `BSB6A_CASES_OUT` set, writes them
   to `cases.json`. Hockey's `hky5aParityCases.test.ts` writes its cases too, for step 6.
2. Starts a cluster, applies `bootstrap.sql` (stubs for Supabase's `auth` schema and roles)
   and every migration up to 075 into a template database, then applies 076 and 077 to three
   copies.
3. `gen_parity.mjs` loads each case as a cloud game (its `client_local_game_id` is the case
   name) and compares `validate_baseball_finalization_policy` with the client score; refused
   cases must stay refused.
4. `malformed.sql` copies parity games with one bad change each and checks each refusal
   message (and that three valid copies are accepted with the right runs).
5. `gen_flow.mjs` runs the walk-off game as real team roles: bind, upload, checkpoint,
   readiness, finalize, refused writes after final, reopen, history, re-finalize, audit rows,
   then the sport gates (Baseball setup version 2 refused, Football refused by the private
   cores, personal Baseball and Hockey binds accepted).
6. Hockey's HKY-5A role flow runs on the 077 schema, without its two lines that no longer
   apply (the 073 handshake pin, which 074 moved to contract 2, and the Baseball refusal), so
   the re-created readiness and finalize still serve Hockey.

The `auth` stubs read the user from `request.jwt.claim.sub` under `SET ROLE authenticated`, so
this covers the SQL, grants and row checks, not PostgREST or the deployed project.
