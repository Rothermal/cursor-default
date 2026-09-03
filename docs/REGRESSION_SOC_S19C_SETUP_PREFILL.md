# SOC-S19C Setup Prefill Regression

Use this checklist for the one-time Soccer Player Setup prefill delivered by
`PLAN_SOC_S19_TEAM_FORMATION.md`. The formation remains team setup data and is
converted only into existing participant status and broad-role fields.

## Deployment Gate

Apply `supabase/migrations/065_soccer_team_formation.sql` before formation
round-trip or setup-prefill verification. Existing schema-version-1 team rows
remain readable, but the pre-065 backend rejects current version-2 saves.

## Automated Coverage

```powershell
pnpm.cmd exec vitest run src/lib/soccer/formation.test.ts src/lib/soccer/settings.test.ts src/lib/soccer/matchReadiness.test.ts src/hooks/useSoccerTeamSettings.test.ts src/lib/soccer/migration065.test.ts
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build
```

Focused coverage verifies readiness decisions, one-time and manual-edit
guards, active-roster role loading, matching and mismatch behavior, stale-id
isolation, broad-role mapping with null tactical labels, and unchanged setup
and event schemas.

## Browser Check

1. Apply migration 065 and save a partial formation for a Soccer team.
2. Start a fresh game from that cloud team with the same Players on field
   count and continue to Match Roster.
3. Confirm every active roster player remains selected. Continue to Opening
   Lineup and confirm assigned players are Starters with the slot's broad role;
   unassigned players are Bench with their saved roster role.
4. Change starter and role choices, navigate between both setup steps, and
   trigger window focus. Confirm the manual edits remain unchanged.
5. Return to Match Setup and then Player Setup. Confirm saved participant edits
   are restored rather than replaced by the team formation.
6. Assign an inactive or removed player in the saved formation. Start a fresh
   setup and confirm no participant is fabricated, valid assignments still
   apply, and the warning points to Team Manage repair.
7. Save a formation whose size differs from the match rule snapshot. Confirm
   no formation assignments apply, roster defaults remain editable, and the
   warning names both counts.
8. Block team-settings loading with no valid cache. Confirm roster defaults
   remain usable; restore connectivity and use Retry before editing to apply
   the formation.
9. Repeat step 8, but edit the match roster before Retry succeeds. Confirm the
   late team settings never overwrite that edit.
10. Kick off and confirm opening-lineup events contain only existing participant
    status and broad roles, with no template id, slot id, or tactical label.

## Expected Boundary

- Local-roster matches and existing Soccer games retain their prior behavior.
- Formation prefill never blocks manual setup or kickoff.
- Team defaults never change from Player Setup or live role/substitution edits.
- `SoccerMatchSetup`, event, fingerprint, transport, Summary, and aggregate
  schemas remain unchanged.
