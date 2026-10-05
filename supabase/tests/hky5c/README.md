# HKY-5C database check

Applies every migration (through 074) to a throwaway PostgreSQL cluster and checks the Hockey
settings writes recorded in `docs/REGRESSION_HKY_5_CLOUD_LIFECYCLE.md`. It never connects to the
Supabase project.

```sh
supabase/tests/hky5c/run.sh                      # as a normal user
PG_RUN_AS=postgres supabase/tests/hky5c/run.sh   # as root (initdb refuses root)
```

Same requirements as [../hky5a/README.md](../hky5a/README.md), and it reuses that check's
`bootstrap.sql`. `HKY5C_WORK` and `HKY5C_PORT` override the work directory and port (default a
new `/tmp/hky5c.*` directory and 55433).

What it does:

1. `src/lib/hockey/migration074.test.ts` builds the settings cases with the client parsers
   (`parseHockeySettings`, `parseHockeyTeamSettings`) and, with `HKY5C_CASES_OUT` set, writes
   each case with the client's verdict to `cases.json`.
2. `gen.mjs` runs every case through `_validate_hockey_settings_payload` and fails unless the
   server accepts exactly what the client accepts. Two team cases name a player who is not active
   on the team, which only the server checks.
3. It then saves as real roles: personal settings with revision conflicts, team settings refused
   for a scorer, a viewer, an outsider, a Basketball team and an inactive goalie, saved by the
   owner and an admin, read by a viewer, two `hockey_settings_changed` audit rows, private helper
   grants, and the exact contract 2 capability response.
