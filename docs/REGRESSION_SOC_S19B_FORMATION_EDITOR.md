# SOC-S19B Formation Editor Regression

Use this checklist for the Team Manage editor delivered by
`PLAN_SOC_S19_TEAM_FORMATION.md`. S19B stores a reusable team default; it does
not apply that default to Player Setup. One-time setup prefill belongs to S19C.

## Deployment Gate

Apply `supabase/migrations/065_soccer_team_formation.sql` before exercising or
deploying current Soccer team-setting saves. The S19A/S19B client writes team
schema version 2, which the pre-065 backend correctly rejects.

## Automated Coverage

```powershell
pnpm.cmd exec vitest run src/lib/soccer/formation.test.ts src/lib/soccer/settings.test.ts src/lib/soccer/matchReadiness.test.ts src/lib/soccer/migration065.test.ts
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build
```

The focused coverage verifies the immutable formation transitions and schema,
rules-only cross-team copying, verified active-roster plumbing, Formation-tab
save cleanup, accessible pitch/list wiring, duplicate-move announcement, and
the existing permission/CAS storage boundaries.

## Browser Check

1. Open Team Manage for a Soccer team as an owner or admin, expand Soccer
   Defaults, and open Formation.
2. Switch among 11v11, 9v9, and 7v7. Confirm only matching templates appear
   and selecting a template writes the same Players on field value into the
   unsaved Rules draft.
3. Assign players from both the pitch and keyboard slot list. Assign one player
   to a second slot and confirm the first slot becomes empty.
4. Save a partial formation, including an empty goalkeeper, refresh, and
   confirm the exact assignments return.
5. Change the rule count without changing the formation. Confirm the mismatch
   remains visible and Save is allowed.
6. Copy rules from another Soccer team. Confirm this team's formation is
   preserved even when the copied player count creates a mismatch.
7. Remove or deactivate an assigned player. Confirm the slot says Player
   unavailable and remains unchanged until an explicit Save from Formation;
   after Save, confirm only that stale assignment is removed.
8. Repeat as scorer or viewer. Confirm the pitch and slot list remain visible
   while template, assignment, clear, and save controls cannot mutate data.
9. Confirm Clear Formation asks for confirmation, remains local until Save,
   and Discard restores the shared version.
10. Cause a revision conflict from a second manager session and confirm Reload
    Shared Version replaces both rule and formation drafts.

## Expected Boundary

- Soccer Player Setup behavior is unchanged until S19C.
- No formation template or slot metadata enters match setup, events, cloud
  event rows, Summary, or aggregates.
- A failed or incomplete roster request never triggers stale-assignment cleanup.
