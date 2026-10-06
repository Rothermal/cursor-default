# HKY-6B1 database check

Applies every migration (through 075) to a throwaway PostgreSQL cluster and checks the Hockey
aggregate pages recorded in `docs/REGRESSION_HKY_6_RELEASE.md`. It never connects to the
Supabase project.

```sh
supabase/tests/hky6b1/run.sh                      # as a normal user
PG_RUN_AS=postgres supabase/tests/hky6b1/run.sh   # as root (initdb refuses root)
```

Same requirements as [../hky5a/README.md](../hky5a/README.md), and it reuses that check's
`bootstrap.sql`. `HKY6B1_WORK` and `HKY6B1_PORT` override the work directory and port (default a
new `/tmp/hky6b1.*` directory and 55434).

What it does:

1. `src/lib/hockey/hky5aParityCases.test.ts` writes the HKY-5A game cases to `cases.json`
   (with `HKY5A_CASES_OUT` set).
2. `gen.mjs` binds five of them as real Hockey cloud games (four team games and one personal
   game), uploads their events, confirms the checkpoint and finalizes each one: completed,
   reopened then ended again, ended early with a reason, abandoned, and a personal tie.
3. It then reads the pages as a viewer, scorer, owner and outsider: only completed team games on
   team and season pages, `canManage` for managers only, the participant source map, keyset
   paging, the player page with the personal game for its recorder, a reopened game dropping
   out, the core's refusals, Basketball and Soccer pages still answering, and the exact
   aggregate handshake (contract 0 when a wrapper is missing, release contract 2 unchanged,
   suspended and anonymous callers refused).
