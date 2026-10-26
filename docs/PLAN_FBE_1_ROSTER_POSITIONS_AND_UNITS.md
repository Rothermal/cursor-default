# Plan: FBE-1 Football Rosters, Positions and Unit Starters

Execution plan for football roster positions, team default starters per unit and
specialist roles. This is the first football phase with visible value and does
not depend on the event model. Parent: [FBE-0](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md).

Status: execution plan approved; owner Q&A started 2026-10-25. Batches A, B and C
approved 2026-10-26. No runtime implementation started.

## Current Implementation Assessment

Reviewed against `89156b6a` on `stattracker`, after Hockey's TUI-2 cutover merged
in #508. FBE-1 remains roster/defaults work only: no Football event registration,
tracker replacement, cloud-game transport or legacy retirement in this phase.

- Reuse the existing position/custom-value controls and shared team-settings
  controller/CAS patterns. Football owns its position catalog and independent
  offense/defense/specialist validation; do not force two-way players into Hockey's
  mutually exclusive starter/goalie model.
- Carry forward approved FBE-0/shared decisions: one team-scoped primary position,
  separate offense/defense starter membership, six specialist assignments, two-way
  and multiple-specialist assignments allowed, no required position composition,
  empty defaults rather than inferred starters, and owner/admin edits with
  scorer/viewer read-only access. Do not re-ask these as unresolved choices.
- Batch A resolves the FBE-2 dependency: FBE-1 stores a team starter-capacity
  preference, default 11, independently of future rules profiles. Its initial
  schema is defaults-only; do not create placeholder Football rules/profile types
  or pretend rules editing has shipped. Later rules integration requires an
  explicit versioned extension preserving these defaults. The roster editing cap
  must not become match-rule authority; game setup must review incompatible
  selections without trimming saved defaults or history.
- Existing settings implementations are further along than the original draft.
  Inspect `src/lib/sportTeamSettings.ts`, the Hockey/Baseball settings panels and
  `src/pages/Teams.tsx` before extracting anything new. Keep compact roster rows
  and bounded tabs consistent with the current app.
- Migration 080 is currently the latest tracked migration. Assign the next number
  only at implementation time; old migration reservations in the parent plan are
  historical, not permission to reuse a number or assume backend capability.

### Batch A: Roster Structure (Approved 2026-10-26)

| Question | Recommended option 1 | Alternative option 2 | Answer |
| --- | --- | --- | --- |
| A1 Position catalog | Keep the catalog below; Slot, Nickel, Rover and EDGE remain supported custom labels | Add those labels to the standard catalog now | Option 1 |
| A2 Starter capacity before FBE-2 | Explicit team starter-cap/format choice now, default 11; keep future match rules separate | Support only 11-player defaults until the rules/profile phase | Option 1 |
| A3 Team editor | One Starters tab with Offense, Defense and Specialists subviews; position stays in compact roster rows | Show all unit/specialist sections together on one page | Option 1 |

Owner reply: "all 1". The schema/UI below consolidate all three approved batches;
keep approved direction and runtime evidence distinct.

### Batch B: Capacity and Display (Approved 2026-10-26)

| Question | Recommended option 1 | Alternative option 2 | Answer |
| --- | --- | --- | --- |
| B1 Capacity control | Presets 5/6/7/8/9/11 plus Custom (whole numbers 1-15); one capacity shared by offense/defense | A numeric-only 1-15 capacity field without presets | Option 1 |
| B2 Lower capacity below existing selections | Keep every selection in the draft, show both over-cap units, and block Save until explicitly resolved | Require reducing selected starters before allowing the capacity change | Option 1 |
| B3 Partial unit defaults | Allow empty/partial units and unset specialists; show counts/incomplete status, never fill automatically | Require full offense and defense units before saving any defaults | Option 1 |
| B4 Compact roster status | Independent offense/defense starter indicators and specialist-role labels; Bench when none apply | One generic Starter/Bench label if assigned anywhere | Option 1 |

Owner reply: "all 1". B1's range is an approved editor/storage safety bound,
not a claim about competition rules or a new playable format.

### Batch C: Starter Editor Interactions (Approved 2026-10-26, Final Batch)

| Question | Recommended option 1 | Alternative option 2 | Answer |
| --- | --- | --- | --- |
| C1 Unit assignment control | Searchable compact active-roster checklist in each unit, with number, name, position and selected state together | Selected-starter list with a separate Add Players picker | Option 1 |
| C2 Adding at capacity | Allow a temporarily over-cap draft for quick swaps; mark the affected units and block Save until resolved, matching B2 | Disable additional selections at capacity until a starter is removed | Option 1 |
| C3 Specialist candidates | Search the full active roster with the matching position first, then the normal position order; allow any player and an explicit Unassigned choice | Use the normal full-roster position order without role-specific prioritization | Option 1 |

Owner reply: "all 1". These are editor-only choices. C3 prioritizes options
without preselecting a player or restricting eligibility; the same player may
hold multiple roles.

---

## 1. Goal

Apply the app-wide roster rule from
[Shared product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md) to Football:

- one default position per player per team,
- team default starters grouped into offense, defense and specialists, with a
  configurable starter capacity (default 11),
- snapshot once into new games (used by FBE-3 setup), never rewritten by games.

---

## 2. Current code to follow

| Concern | Existing pattern | Football choice |
| --- | --- | --- |
| Position storage | Basketball BAR-1: plain code/custom label in `team_players.position`, `src/lib/basketball/positions.ts`, 80-char limit; Soccer: `soccer:<group>` in `src/lib/soccer/rosterRole.ts` | Basketball form: plain code or custom label |
| Starter defaults | Soccer S23 `lineupDefaults` v1 in team settings (migration 068); Basketball BAR-1 `lineupDefaults` in team settings schema 2 (migration 070) | New football team settings with a per-unit `lineupDefaults` |
| Team settings storage | `team_sport_settings` + revision CAS RPC + metadata-only audit (migration 048, SOC-6D, BKE-5B) | Same tables; new fixed football RPC and validator |
| Roster editor | `src/pages/Teams.tsx` roster add/edit with sport-aware position control | Football position control grouped by unit |
| Team Manage tabs | Soccer Rules/Formation/Lineup Defaults; Basketball roster defaults | Football Rules (FBE-6) / Starters tabs |

---

## 3. Position catalog

`src/lib/football/positions.ts`:

```ts
export const FOOTBALL_POSITION_GROUPS = [
  { unit: 'offense',    positions: ['QB', 'RB', 'FB', 'WR', 'TE', 'C', 'G', 'T', 'OL'] },
  { unit: 'defense',    positions: ['DE', 'DT', 'NT', 'DL', 'OLB', 'ILB', 'LB', 'CB', 'FS', 'SS', 'S', 'DB'] },
  { unit: 'specialist', positions: ['K', 'P', 'LS', 'H', 'KR', 'PR'] },
] as const
```

- Labels shown with full names (Quarterback, Running Back ...). Codes are stored.
- Sorting: offense, defense, specialists in catalog order, then custom (alphabetical),
  then Unassigned. Within a position, jersey number then name then id, matching
  Soccer's actor order.
- Custom positions are preserved verbatim (e.g., "Slot", "Wildcat", "Rover"),
  trimmed, max 80 characters. An unrecognized stored value is custom, never coerced.
- Missing value = Unassigned.
- Slot, Nickel, Rover and EDGE remain custom labels, not new standard catalog
  entries (A1). Future flag-profile filtering is display-only FBE-3 work; FBE-1
  does not infer competition rules or hide positions from the team roster editor.

Position does not restrict eligibility anywhere. A WR can be a rusher or a passer.

---

## 4. Team settings: football schema version 1

```ts
interface FootballTeamSettingsV1 {
  settingsSchemaVersion: 1
  lineupDefaults: {
    version: 1
    starterCapacity: number  // editor cap, integer 1..15, default 11
    units: {
      offense: string[]     // stable player UUIDs, 0..starterCapacity
      defense: string[]     // 0..starterCapacity
    }
    specialists: {          // each one player or null
      K: string | null; P: string | null; LS: string | null
      H: string | null; KR: string | null; PR: string | null
    }
  }
}
```

Rules:

- Player ids are unique within a unit; the same player may appear in both units
  and in any number of specialist roles (two-way and kicker/punter is common).
- One integer team starter capacity from 1 through 15 bounds each unit
  independently, default 11. Presets are 5/6/7/8/9/11; Custom accepts any integer
  in that range. It does not load Football profiles, select field dimensions or
  determine a game's rules.
- Lowering capacity and adding a player at capacity both preserve all draft
  selections and show a validation error for every affected unit. Save rejects
  over-cap units; no player is silently removed. Keep editable draft state
  distinct from strict persisted-payload parsing so a temporarily invalid draft
  can be corrected without being dropped or replaced with defaults.
- Empty and partial offense/defense units and unset specialists are valid saved
  defaults. Show completeness/counts without automatically assigning players.
- All ids must be active members of the team roster at save.
- Missing settings = capacity 11, empty units and no specialists.
- No `baseProfile`/`ruleOverrides` placeholders in schema 1. Future rules fields
  need a reviewed versioned extension, preserving roster defaults and rejecting
  unknown payloads rather than silently discarding fields.

Migration (next number at implementation time) adds:

- `_validate_football_settings_payload(scope, payload)`: exact keys, types,
  uuid format, duplicates and unit caps from the validated starter capacity.
- `save_football_team_settings_revisioned(team_id, expected_revision, settings)`:
  security definer, active app access, owner/admin only, sport must be football,
  advisory lock, roster membership check, metadata-only audit event
  `football_settings_changed` with coarse defaults/capacity categories. No rules
  audit category is emitted by this phase.
- Read path: the existing generic team settings read RLS.

No existing tables change; no historical data is rewritten.

---

## 5. UI

Team Manage for a football team gets a **Starters** tab (Rules comes in FBE-6):

- Offense, Defense and Specialists subviews within one Starters tab (A3), not a
  long page of all three editors. Changing a view preserves one shared unsaved
  draft; no save occurs on navigation. Keep capacity/count and save/conflict
  controls easy to reach without duplicating authority across subviews.
- Each unit uses a searchable compact active-roster checklist with number, name,
  position and selection together (C1). Candidates sort by position with the
  unit's own positions first; no candidate is excluded by position. Counts such
  as "9 of 11" describe the full selected unit, not only search matches. Search
  never changes assignments, and clearing it restores all candidates.
- Capacity uses the B1 presets and Custom input. Lowering it never clears
  selections. Report offense and defense errors even when the affected subview
  is not currently open, and keep Save blocked until both fit. Allow additional
  selections at capacity for quick swaps (C2); removing players stays available
  while the draft is invalid. No temporary over-cap draft reaches storage.
- Specialists subview: six compact rows (Kicker, Punter, Long snapper, Holder, Kick
  returner, Punt returner) with a searchable single-select each. Matching primary
  positions come first, then remaining players in normal position order (C3).
  All active players remain eligible; each picker has an explicit Unassigned
  choice. Search, position changes and opening a picker never assign a player.
- Compact roster rows show independent offense/defense starter indicators and
  specialist-role labels alongside number, name and position. Show Bench only
  when the player has no unit starter or specialist assignment; this describes
  team defaults, not current on-field status.
- Read-only for scorer/viewer. One explicit Save submits the capacity, both units
  and all specialist assignments together through revision CAS with the shared
  conflict handling; no subview autosaves. Inactive/removed players show a
  warning and block Save. An explicit "Remove unavailable players" action cleans
  only the draft; the saved assignments change only on a subsequent successful
  Save (the existing Soccer/Hockey pattern).
- Roster add/edit for football teams shows the grouped position select plus
  Custom.

Keyboard operable, 390 px and 1280 px layouts, both themes (THM tokens).

---

## 6. Game setup consumption (used by FBE-3)

This section is a future integration contract, not FBE-1 runtime scope. FBE-1
does not change current Football game creation, its aggregate tracker, event
registration, cloud-game transport or old-game editing/retirement policy.

- Fresh football setup for a cloud team snapshots positions, unit starters and
  specialists into the local setup draft once, after a coherent roster load.
- Saved draft participant choices and recorder edits always win; later default
  edits never rewrite a draft or a game.
- The team editing capacity never overrides frozen match rules. FBE-3 checks
  default selections against the chosen game's effective size, requiring explicit
  review if they do not fit; no automatic trimming or write-back to the team.
- Local-only teams start with Unassigned positions and empty units.

---

## 7. Tests and regression

- Catalog parse/serialize, custom preservation, ordering.
- Settings parser: exact keys, integer 1-15 editing cap, independent offense and
  defense limits, empty/partial units, duplicates, specialists nullability, and
  no dependency on FBE-2 rules types.
- SQL migration test in the style of `src/lib/gameEvents/migration*.test.ts`
  checking the validator and RPC text.
- Team Manage component tests: read-only roles, CAS conflict, cleanup, preserved
  selections after reducing capacity, visible validation across subviews,
  partial-default saves, and independent unit/specialist status labels. Exercise
  both over-capacity paths, shared draft persistence between subviews, search
  without selection/count changes, explicit specialist clearing, position-first
  specialist ordering and two-way/multiple-specialist assignments.
- Regression matrix `docs/REGRESSION_FBE_1_ROSTER_DEFAULTS.md`: owner/admin edit,
  scorer/viewer read-only, two-way player, starter-capacity preset 8 and Custom
  1-15 (not rules profiles), inactive player cleanup, other sports' Team Manage
  unchanged.

---

## 8. Q&A Status

Batches A, B and C are approved in the decision records above. No owner design
questions remain for FBE-1. The former questions about full special-teams units
and required position composition are already answered by FBE-0/shared decisions:
six specialist roles only, and no required positional shape. Do not reopen them
without a new owner request.

Implementation can follow the existing position controls and team-settings
patterns in one focused feature PR, including the next available migration and
regression record. Do not split this phase into new micro-phases unless the
actual implementation exposes a consequential dependency. FBE-2/FBE-3 decisions
remain separate; completing this Q&A does not approve their runtime behavior or
establish test, database or release signoff.
