# Regression - SOC-S23B lineup defaults editor

**Prerequisite:** migration `068_soccer_lineup_status_defaults.sql` is applied.

**Scope:** Team Manage editing and review only. Player Setup does not consume
saved lineup defaults until S23C.

## 1. Automated coverage

The focused suite covers:

- deterministic Starter/Bench grouping and Forward, Midfielder, Defender,
  Goalkeeper, Custom ordering;
- zero-starter, excess-starter, and goalkeeper-count warnings;
- read-only status presentation without mutation controls;
- one coherent all-membership roster query with active-only editor rows;
- three-tab keyboard identity/focus wiring; and
- positive, mutually exclusive Formation and Lineup Defaults cleanup modes.

Run:

```powershell
pnpm exec vitest run src/components/soccer/SoccerLineupDefaultsEditor.test.ts src/lib/soccer/matchReadiness.test.ts src/lib/soccer/lineupDefaults.test.ts src/lib/soccer/settings.test.ts src/lib/soccer/teamSettingsSync.test.ts src/hooks/useSoccerTeamSettings.test.ts
```

## 2. Owner/admin editor

1. Open Team Manage for a Soccer team and open Soccer Defaults.
2. Use Arrow keys, Home, and End across Rules, Formation, and Lineup Defaults.
3. Mark a normal starting group, including exactly one goalkeeper, and save.
4. Reload Team Manage.

Expected:

- focus, selection, and the visible panel move together across all three tabs;
- active players are grouped as Starter or Bench and ordered by role, jersey,
  name, then stable player id;
- the count reads `Starters X / maxOnFieldPlayers`;
- status changes do not alter Formation assignments; and
- reload restores the exact saved statuses.

## 3. Warning and cleanup behavior

1. Save zero starters, too many starters, and a group without exactly one
   goalkeeper.
2. Confirm each warning remains non-blocking.
3. Deactivate a saved starter, save from Rules, then reactivate the player.
4. Remove a disposable player with no retained membership, reopen Lineup
   Defaults, and save that tab.

Expected:

- warnings describe the draft without automatically choosing players;
- inactive members remain stored and return with their prior status;
- Rules and Formation saves do not clean lineup ids; and
- only an explicit Lineup Defaults save removes missing membership ids.

## 4. Readiness, access, and conflicts

1. Delay or fail the roster load and confirm controls remain unavailable and
   no stored id is classified as stale.
2. Open as scorer/viewer and review all three tabs.
3. Trigger a two-session revision conflict and choose the cloud version.

Expected:

- cleanup waits for both active-roster and complete-membership readiness;
- scorer/viewer users see statuses but no Starter/Bench mutation controls or
  Save/Discard footer; and
- conflict replacement updates rules, formation, and lineup defaults together.

## 5. Exit

- Focused tests and the repository gate pass.
- Migration 068 is already deployed.
- One owner/admin round-trip preserves exact lineup defaults.
- Scorer/viewer review is read-only.
- Player Setup remains unchanged until S23C.
