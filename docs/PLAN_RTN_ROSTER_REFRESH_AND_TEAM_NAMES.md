# RTN: Roster Refresh, Team Nicknames and Saved Opponents

Status: Proposed planning PR, waiting for owner review. RTN-0 (code splitting)
was approved by Mark on 2026-11-07 ahead of the rest and is implemented in the
same PR; RTN-1 onward wait for plan approval.

RTN-0 result: every routed page except Auth, the access gate and the dev-only
shot-chart preview is `React.lazy` in `App.tsx`, behind `RouteChunkBoundary`
(Suspense plus a Reload prompt if a page chunk fails to load). Local build: the
app chunk went from 2,839,939 bytes (90.3% of the limit) to 904,726 bytes
(28.8%); the largest page chunk is 227,201 bytes; total precache 2,928.83 KiB
over 136 entries (was 2,883.37 KiB over 15). Typecheck clean, lint 0 errors and
the 3 known warnings, 355 test files / 3,669 tests pass. Production-build smoke
test in Chromium opened 14 routes with no page errors, and setup and Settings
pages reloaded offline from the service-worker cache.

Owner request (2026-11-07): "Basketball first but should apply to all sports.
Need an option to refresh player metadata, numbers, positions during a game. The
ability to pull in new numbers to an existing game. Team nicknames should be
storable at the team level. Opponent team names and nicknames should also be
storable and editable."

## 1. What exists today

Checked against `stattracker` at `8e1df93`.

- **Team nickname is already stored on the team.** `teams.nickname` exists since
  migration 002. Team Manage (`src/pages/Teams.tsx`, `startEditTeam` /
  `handleSaveTeam`) edits name and nickname, and Basketball setup prefills the
  game's Team Nickname from the selected team (`GameSetup.tsx`). The gap is the
  other direction: a nickname typed or changed in setup is saved only on that
  game (`games.tracked_team_nickname`, migration 066) and never reaches the
  team. Soccer, Hockey and Baseball setup have their own team pickers and need
  the same check.
- **Opponents are free text per game.** `games.opponent_name` and
  `games.opponent_nickname` (066) are snapshots. There is no opponent table, no
  picker and no way to reuse or correct an opponent across games.
- **Game rosters are frozen at setup.** A Basketball event game copies each
  player's `number` and `position` into `BasketballMatchSetup.participants`
  (immutable setup). The only in-game roster events are
  `basketball.match_roster_added` (late add, always `position: null`) and
  `basketball.participant_resolved`. Soccer has the same two event types. Nothing
  changes a participant's number or position after the game starts, so a
  roster correction in Team Manage never reaches a game in progress or a
  finished game.
- **Bundle headroom.** The single app chunk is 2,839,939 bytes in a local build
  without Supabase env (90.3% of the 3 MiB PWA precache limit; the build already
  warns above 90%). Every page is imported eagerly in `App.tsx`.

## 2. Proposed design

### 2.1 Shared roster refresh (all event sports)

One neutral model, one dialog, one event shape per sport.

- `src/lib/rosterRefresh.ts` (pure): takes the game's participants
  (`participantId`, `playerId`, `teamSide`, `displayName`, `number`,
  `position`) and the current team roster rows (`playerId`, `jersey_number`,
  `position`, `is_active`, name) and returns:
  - `updates`: participants whose number or position differs from the roster;
  - `additions`: active roster players not in the game (offered as late adds,
    which also covers open issue #428);
  - `unmatched`: game participants with no roster row (shown, never removed).
  Only tracked-team participants with a `playerId` are matched. Opponent
  participants are edited by hand only.
- `src/lib/teamRosterSnapshot.ts`: loads `team_players` + `players` for the
  game's `sourceTeamId`. Local-only games and games without a source team show
  manual edit only.
- `src/components/roster-refresh/RosterRefreshDialog.tsx`: lists each change as
  "#12 → #21, G → PG" with a checkbox (all checked by default), plus the
  additions list, then Apply. The tracker roster sheet also gets a per-player
  "Edit number / position" action for one-off corrections, including opponent
  players.
- New per-sport event `<sport>.participant_details_updated` with payload
  `{ participantId, number, position, source: 'roster_refresh' | 'manual' }`.
  Setup stays immutable; the projector applies the latest details event to the
  projected participant. No event schema version bump, so server finalization
  is untouched (its event-type filters do not include roster events).
- **Display rule:** Summary, box score, timeline actor labels and exports show
  the participant's current number. The timeline shows the details event itself
  as "Roster change: #12 is now #21". Stats stay keyed by participant and player
  id, so aggregates do not change.
- **Existing games:** Refresh is available while the game is live and on a
  reopened game. A finalized game shows "Reopen to refresh roster" because a
  new event on a final game would change the recorded stream after finalization.

### 2.2 Saved opponents (all sports)

- Migration 082 adds `public.opponent_teams`
  (`id`, `owner_id`, `sport_id`, `name`, `nickname`, `created_at`,
  `updated_at`, `archived_at`), unique on owner + sport + lower(trim(name)) for
  unarchived rows, with the same 1..100 length checks as 066 and owner-only RLS.
- `games` gets nullable `opponent_team_id uuid references opponent_teams on
  delete set null`. The game keeps its `opponent_name` / `opponent_nickname`
  snapshot, so history never silently changes.
- Setup: the Opponent field becomes a picker (type to filter saved opponents,
  pick one to fill name and nickname, or type a new name). A new name shows
  "Save opponent for future games" (checked by default).
- Management: a Saved Opponents section on the sport dashboard or Team Manage
  page to add, rename, change nickname and archive.
- Renaming a saved opponent asks "Also update N past games against this
  opponent?" and only rewrites the game snapshots when confirmed.
- Game Info gets Edit on a game's opponent name and nickname, for one-off
  corrections.

### 2.3 Team nickname save-back

When the Team Nickname in setup differs from the selected team's stored
nickname, setup shows "Save as team nickname" (unchecked by default) and writes
`teams.nickname` on start if checked and the user can manage the roster. No
migration needed.

## 3. Slices

Each slice is one PR, reviewed and merged by Mark before the next starts.

| Slice | Scope | Migration |
| --- | --- | --- |
| RTN-0 | Route-level code splitting: lazy-load each sport's setup, tracker and Summary pages, Admin and team pages, with a shared Suspense fallback. Keeps the precache warning gate. Prerequisite for the rest. | none |
| RTN-1 | Saved opponents table, Basketball setup picker, Saved Opponents management, Game Info opponent edit, team nickname save-back in Basketball setup. | 082 |
| RTN-2 | Basketball roster refresh: shared diff model, roster snapshot loader, `basketball.participant_details_updated`, refresh dialog, per-player edit, late adds from roster, Summary/timeline display. | none |
| RTN-3 | Soccer, Hockey and Baseball: opponent picker and nickname save-back in their setups, and each sport's details event plus the shared dialog. One PR per sport (3A Soccer, 3B Hockey, 3C Baseball). Football adopts it inside FBE-1/FBE-3 when its event setup exists. | none |

Each sport keeps its notes inside its own AGENTS.md marker slot.

## 4. Questions for Mark

Recommended answers are in bold.

1. **Saved opponent scope.** Should the opponent list be **per sport for your
   account (reused across seasons and teams)**, or per team/season?
2. **Number history.** After a number change, should Summary and timeline show
   **the current number everywhere**, or the number the player wore when each
   play happened?
3. **Finished games.** For "pull new numbers into an existing game", is
   **reopen, refresh, finalize again** acceptable, or should finalized games
   allow a details-only refresh without reopening?
4. **Write back to roster.** When you edit a number in the game, should it
   **offer an "Also update team roster" checkbox (unchecked by default)**, or
   stay game-only?
5. **Past games on opponent rename.** **Ask each time** (recommended), always
   update, or never update?
6. **Bundle split first.** OK to do **RTN-0 first** even though it has no visible
   feature?
