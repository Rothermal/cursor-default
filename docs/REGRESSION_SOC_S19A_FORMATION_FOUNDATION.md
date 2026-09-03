# SOC-S19A Formation Foundation Regression

Use this checklist for the domain and storage foundation delivered by
`PLAN_SOC_S19_TEAM_FORMATION.md`. S19A does not expose the formation editor or
apply formations to Player Setup; those surfaces belong to S19B and S19C.

## Automated Coverage

```powershell
pnpm.cmd exec vitest run src/lib/soccer/formation.test.ts src/lib/soccer/settings.test.ts src/lib/soccer/teamSettingsSync.test.ts src/hooks/useSoccerTeamSettings.test.ts src/lib/soccer/personalSettingsSync.test.ts src/lib/soccer/migration048.test.ts src/lib/soccer/migration065.test.ts
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build
```

The focused suite verifies:

- all nine fixed templates and their count, goalkeeper, role, coordinate,
  ordering, and immutability invariants;
- exact formation parsing, UUID assignments, template-specific slots, and
  one-slot-per-player enforcement;
- clone-safe assign, clear, template-switch, stale-player, and explicit-save
  transitions;
- fail-closed setup prefill with broad roles and `initialRole.label: null`;
- unchanged personal schema version 1 behavior;
- legacy team schema version 1 normalization and current team schema version 2
  round-trip behavior;
- version-2 cache writes plus version-1/version-2 cache and cloud reads;
- rules-only cross-team copy for both saved-source and no-settings branches;
  and
- private SQL validation, revisioned owner/admin writes, and coarse formation
  audit metadata.

## Migration

Apply `supabase/migrations/065_soccer_team_formation.sql` before or atomically
with the S19A application deploy. From S19A onward, every Soccer team-settings
save writes schema version 2; the pre-065 backend rejects both that version and
its `{ rules, formation }` payload. The migration keeps personal Soccer
settings at schema version 1, keeps accepting legacy team version 1 `{ rules }`,
and permits current team version 2 `{ rules, formation }`.

After applying it, confirm the migration completes without error. Existing
team settings do not require a bulk update; their first explicit save from a
current client upgrades that row to version 2.

## Focused Browser Check

1. Open Team Manage for an existing Soccer team with saved defaults.
2. Confirm the existing rule defaults still load.
3. Change one rule and save it.
4. Refresh and confirm the rule remains saved and the page reports a synced
   state.
5. Copy defaults from a compatible Soccer team and confirm the rule values
   change and the page remains synced. Automated coverage protects the hidden
   target formation until S19B makes it visible.
6. Confirm personal Soccer settings still load and save normally.

## Expected Boundary

- No formation metadata appears in `SoccerMatchSetup`, event streams, cloud
  game-event rows, Summary, or aggregates.
- Existing match setup and live tracking behavior are unchanged.
- Team formation editing is not expected until S19B.
- Formation prefill is not expected until S19C.
