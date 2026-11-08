# RTN: Roster Refresh, Team Nicknames and Saved Opponents

Status: Plan and RTN-0 merged in #518 (2026-11-08). Mark accepted all six
recommended answers on 2026-11-08 (section 4). RTN-1 is implemented for review;
migration 082 is not yet applied. RTN-2 onward follow.

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
- No link column on `games` (changed during RTN-1): each game keeps its
  `opponent_name` / `opponent_nickname` snapshot, so history never silently
  changes. The rename prompt finds past games by your account, the sport and a
  case-insensitive match on the old name.
- Final games are immutable (trigger from 035/055). Migration 082 re-creates
  that trigger with one narrow allowance: inside `set_game_opponent_labels`,
  only `opponent_name`, `opponent_nickname` and `updated_at` may change, on
  any game status. The RPC is limited to the game's creator or a team
  owner/admin. The RPC also stamps `games.opponent_labels_edited_at`; after
  that, the trigger keeps the relabeled opponent on every ordinary write, so a
  sync from an older copy (another device, or the creator while an admin
  renamed it) cannot put the old name back. Device copies on the editing
  device are relabeled too; a copy that was in sync stays in sync, so a final
  copy does not turn "unsynced". Other devices show the old name locally until
  they reopen the game from the cloud.
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

Recommended answers are in bold. Mark accepted all six on 2026-11-08.

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

## 5. RTN-1 delivery record

- Migration `082_saved_opponents_and_game_labels.sql`: `opponent_teams`
  (owner-only RLS, unique active name per owner and sport, archive instead of
  delete) and `set_game_opponent_labels`. Not yet applied.
- `src/lib/opponentTeams.ts` (parse, filter, save candidate, CRUD, relabel RPC),
  `src/lib/opponentLocalGames.ts` and `src/hooks/useOpponentRelabel.ts` (server
  plus every device copy), `src/hooks/useSavedOpponents.ts`.
- Basketball setup (`GameSetup.tsx`): `OpponentPicker` filters saved opponents
  and fills the nickname; "Save opponent for future games" (checked by default)
  or "Update the saved nickname"; "Save as the team's nickname" (unchecked by
  default, managers only). Saves run after setup commits and never block start.
  Hidden in local-only mode.
- Sport dashboard > Saved Opponents (`/opponents?sport=`): add, edit, remove;
  a rename or nickname change asks "Update N past games?".
- Game Info: Edit on the Opponent tile, final games included.
- RTN-0 follow-up: `RouteChunkBoundary.test.ts` covers loading to success and
  failed chunk to Reload to recovery on navigation.
- Review fixes: the relabel RPC fails closed for non-members; local settlement
  is guarded by the auth identity and keyed by cloud game id; in-sync copies keep
  their synced fingerprint; relabeled games are locked against header resends.
- Checks: typecheck clean; lint 0 errors / 3 known warnings; 360 files / 3,705
  tests; build passes, app chunk 905,737 bytes. Local-mode Chromium smoke
  (390 px): setup shows the picker without save controls, Saved Opponents shows
  the sign-in note, dashboard shows the button, no page errors.
- Pending owner checks (need 082 applied): save a new opponent at setup, pick it
  in a second game, change its nickname, rename it and update past games
  (including a final game), Game Info edit on a final game, team nickname
  save-back, a parked final copy staying deletable after a rename, a team admin's
  rename surviving the creator's next sync, and a non-member being refused.
