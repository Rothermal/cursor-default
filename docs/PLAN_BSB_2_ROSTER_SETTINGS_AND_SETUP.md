# Plan: BSB-2 Baseball Roster Positions, Team Defaults and Game Setup

Status: implemented (BSB-2A, 2B, 2C); migration 071 applied by Mark 2026-09-29. Approved to start by Mark (2026-09-27, "Start BSB-2"). Builds on the merged
BSB-1 engine ([plan](PLAN_BSB_1_EVENT_FOUNDATION.md)). Product model:
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) sections 5, 9 and 12.

Exit condition (BSB-0 roadmap): a local Baseball event game starts from team defaults
and reloads/parks safely. Baseball event games stay behind a development-only gate
until BSB-7; legacy Baseball stat-grid games are unchanged.

---

## 1. Scope

In scope:

- Baseball positions on team rosters (Team Manage add/edit/read-only).
- Team Baseball settings: rules profile, a small set of rule overrides, and default
  lineup (batting order plus defense by fielding number), saved through a new
  sport-bounded RPC in migration 071.
- A development-only Baseball event setup screen that builds a `BaseballMatchSetup`
  from a local roster or an existing cloud team (prefilled from team defaults),
  initializes the event game, and parks/reloads like any other game.
- A development-only holding page on `/game` for Baseball event games that shows the
  frozen setup and lets the recorder start the game. The live tracker is BSB-3.

Out of scope: the diamond, pitch pad and any capture UI (BSB-3); substitutions and
corrections (BSB-4); personal settings sync, capability handshake and release stage
(BSB-7); cloud transport (BSB-6). Hockey and Football are not changed.

---

## 2. Decisions and Defaults

Carried from shared product decisions and BAR-1 (Basketball roster defaults):

- One default position per player, stored as a plain code in `team_players.position`
  (`P, C, 1B, 2B, 3B, SS, LF, CF, RF, SF, DH, EH, DP, FLEX`). Custom text is kept;
  blank is Unassigned. No backfill and no rewrite of existing values until an explicit
  edit. Game setup snapshots positions; later roster edits never change a game.
- Missing defaults mean Unassigned and not in the lineup. Nothing is inferred from
  jersey number or roster order.
- Team defaults are copied into new games only. Editing defaults never rewrites an
  existing game's setup.

Defaults chosen here (no owner input needed; listed so they can be changed):

- Team settings carry the profile, overrides for `scheduledInnings`,
  `battingOrderFormat`, `maxExtraHitters`, `runRules` and `pitchCountLimit`, and the
  default lineup. Every other rule comes from the profile and can still be changed per
  game at setup.
- Personal (device/account) Baseball settings are deferred to BSB-7. Until then, a
  game without a team starts from the default NFHS baseball profile.
- Owners and admins edit team defaults; scorers and viewers see them read-only (same as
  Basketball and Soccer).
- The opponent is recorded as nine batting slots by default (count editable 1..30), each
  with optional name, number and position, plus a starting pitcher label/number (Mark's
  decision: opponent batting-order slots).
- The setup gate is `isBaseballEventPreviewAvailable()` in `sportAvailability.ts`
  (development builds only), reached at `/setup?sport=baseball&events=1`, mirroring
  Hockey's preview gate. Production never renders it.

---

## 3. Contracts

### 3.1 Team settings v1

```text
BaseballTeamSettingsV1
  settingsSchemaVersion: 1
  baseProfile: { profileId: BaseballProfileId, profileVersion: 1 }
  ruleOverrides: Partial<{ scheduledInnings, battingOrderFormat, maxExtraHitters,
                           runRules, pitchCountLimit }>
  lineupDefaults: {
    version: 1
    battingOrder: playerId[]            unique, at most 30, active roster only
    defense: Record<'1'..'10', playerId> unique players, active roster only
  }
```

Stored in `team_sport_settings` (`sport_id = 'baseball'`, `schema_version = 1`).
Client parsing is exact (unknown keys, wrong types, unknown profile or invalid
resolved rules fail closed with the layer named). The effective rules are
`createBaseballMatchRules(profileId, overrides)` checked by
`normalizeBaseballMatchRules`.

### 3.2 Migration 071

`supabase/migrations/071_baseball_team_settings.sql` adds only:

- `_validate_baseball_team_settings_payload(p_team_id, p_settings)`: exact keys and
  types, known profile id and version 1, override keys limited to the list above with
  basic type/range checks, lineup ids are UUIDs, unique, and active members of the team.
- `save_baseball_team_settings_revisioned(p_team_id, p_expected_revision, p_settings)`:
  authenticated, active app access, owner/admin, team season sport is `baseball`,
  advisory lock, validation, then `_save_sport_settings_revisioned_core` with audit
  event `baseball_settings_changed`. Granted to `authenticated`.

It does not touch Soccer or Basketball functions, the event-platform allow-lists
(shared XS-2 work, numbered when a sport reaches cloud), or any existing rows.

### 3.3 Setup draft to `BaseballMatchSetup`

The setup screen keeps an in-memory draft and produces the BSB-1 setup v1:

- Participants: the players the recorder selects (roster snapshot: player id, name,
  number, position; bats/throws optional), each with a new participant id.
- Tracked lineup: batting order of participant ids and defense by fielding number,
  prefilled once from team defaults for selected players, then freely edited.
  `validateBaseballMatchSetup` is the gate; its message is shown inline.
- Opponent slots and pitcher as in section 2.
- Continue commits a new local game slot with game info (team name, opponent, date),
  `gameDataAuthority: 'sport_events'`, and the initialized Baseball state, then opens
  `/game`. Baseball event games are never cloud-synced (`cloudSyncRouteForState`
  already returns `unsupported`).

---

## 4. Slices

| Slice | Content | Exit |
| --- | --- | --- |
| BSB-2A | `BaseballPositionField`; Team Manage roster add/edit/read-only positions for Baseball teams; position label/sort helpers | A Baseball team roster saves standard, custom and Unassigned positions; other sports unchanged |
| BSB-2B | `baseball/settings.ts` (exact parser, resolver, lineup defaults), cloud client + `useBaseballTeamSettings`, `BaseballTeamSettingsPanel` in Team Manage, migration 071 | Owner/admin saves profile, overrides and default lineup with CAS; read-only for others; stale/inactive players flagged |
| BSB-2C | Dev gate, `BaseballEventSetup` page, setup builder and prefill helpers, game-slot commit, `/game` holding page with Start | A local event game starts from team defaults, parks, resumes and reloads with setup intact |

---

## 5. Tests

- Positions: normalization, custom and Unassigned, sort order.
- Settings: exact parsing, unknown profile, invalid overrides, resolved rules, lineup
  defaults (duplicates, inactive players, defense uniqueness), clone safety.
- Setup builder: prefill from defaults only for selected players, never inferred;
  validation messages; DH/continuous lengths; opponent slot generation.
- Gate: preview hidden in production; release-guard allowlists updated for the new
  policy function only.
- Integration: build setup, initialize, park, export/import, reload; fingerprint and
  setup unchanged; cloud route stays `unsupported`; legacy Baseball unchanged.

---

## 6. Risks

- **Team Manage size.** `Teams.tsx` already branches on Soccer and Basketball. Keep the
  Baseball branch to the same three insert/update sites and one field component.
- **Migration before client.** Team default saves need 071 applied first; the panel
  shows the RPC error plainly if it is missing, and reads still work.
- **Roster churn.** Default lineup ids can go stale when players leave; the panel flags
  them and the server rejects saving inactive players (Basketball 070 pattern).

---

## 7. Delivery Record

- BSB-2A/2B: `BaseballPositionField`, Team Manage position editing, `baseball/settings.ts`,
  `teamSettingsSync.ts`, the sport-neutral `useSportTeamSettings` hook,
  `BaseballTeamSettingsPanel`, and migration 071.
- BSB-2C: `isBaseballEventPreviewAvailable`, `baseball/setupBuilder.ts`,
  `pages/BaseballEventSetup.tsx` (local players or a cloud team prefilled once from
  defaults) and `pages/BaseballEventGame.tsx` (frozen setup review and Start).
- Verification: [REGRESSION_BSB_2_ROSTER_SETTINGS_AND_SETUP.md](REGRESSION_BSB_2_ROSTER_SETTINGS_AND_SETUP.md).
