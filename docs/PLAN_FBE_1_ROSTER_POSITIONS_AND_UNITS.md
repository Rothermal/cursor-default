# Plan: FBE-1 Football Rosters, Positions and Unit Starters

Execution plan for football roster positions, team default starters per unit and
specialist roles. This is the first football phase with visible value and does
not depend on the event model. Parent: [FBE-0](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md).

Status: proposed; awaiting owner Q&A.

---

## 1. Goal

Apply the app-wide roster rule from
[Shared product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md) to Football:

- one default position per player per team,
- team default starters, organized the way football teams actually think about
  them: an offensive eleven, a defensive eleven and specialists,
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
- Flag profiles use the same catalog; their UI hides linemen by default (display
  only).

Position does not restrict eligibility anywhere. A WR can be a rusher or a passer.

---

## 4. Team settings: football schema version 1

```ts
interface FootballTeamSettingsV1 {
  baseProfile: FootballProfileId | null     // rules, FBE-6 adds editing
  ruleOverrides: Partial<FootballRules>     // sparse; empty in FBE-1
  lineupDefaults: {
    version: 1
    units: {
      offense: string[]     // ordered stable player UUIDs, 0..playersPerSide
      defense: string[]     // 0..playersPerSide
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
- Max per unit comes from the resolved profile's players per side (11 default;
  8, 6, 7, 5 by profile). Fewer is allowed (warn only).
- All ids must be active members of the team roster at save.
- Missing settings = empty units and no specialists.

Migration (next number at implementation time) adds:

- `_validate_football_settings_payload(scope, payload)`: exact keys, types,
  uuid format, duplicates, unit caps by profile.
- `save_football_team_settings_revisioned(team_id, expected_revision, settings)`:
  security definer, active app access, owner/admin only, sport must be football,
  advisory lock, roster membership check, metadata-only audit event
  `football_settings_changed` with coarse categories (`rules`, `lineup_defaults`).
- Read path: the existing generic team settings read RLS.

No existing tables change; no historical data is rewritten.

---

## 5. UI

Team Manage for a football team gets a **Starters** tab (Rules comes in FBE-6):

- Two columns (Offense, Defense) each listing selected starters in position order
  with a count "9 of 11". Add from a picker of active roster players sorted by
  position with the unit's own positions first.
- Specialists: six compact rows (Kicker, Punter, Long snapper, Holder, Kick
  returner, Punt returner) with a single-select each.
- Read-only for scorer/viewer. Save uses revision CAS with the shared conflict
  message; inactive/removed players show a warning with an explicit "remove
  unavailable" cleanup only on save (Soccer S23 behavior).
- Roster add/edit for football teams shows the grouped position select plus
  Custom.

Keyboard operable, 390 px and 1280 px layouts, both themes (THM tokens).

---

## 6. Game setup consumption (used by FBE-3)

- Fresh football setup for a cloud team snapshots positions, unit starters and
  specialists into the local setup draft once, after a coherent roster load.
- Saved draft participant choices and recorder edits always win; later default
  edits never rewrite a draft or a game.
- Local-only teams start with Unassigned positions and empty units.

---

## 7. Tests and regression

- Catalog parse/serialize, custom preservation, ordering.
- Settings parser: exact keys, unit caps, duplicates, specialists nullability.
- SQL migration test in the style of `src/lib/gameEvents/migration*.test.ts`
  checking the validator and RPC text.
- Team Manage component tests: read-only roles, CAS conflict, cleanup.
- Regression matrix `docs/REGRESSION_FBE_1_ROSTER_DEFAULTS.md`: owner/admin edit,
  scorer/viewer read-only, two-way player, 8-player cap, inactive player cleanup,
  other sports' Team Manage unchanged.

---

## 8. Questions to confirm in FBE-1 Q&A

1. Is the position list right for your teams (e.g., do you want `Slot`, `Nickel`,
   `Rover`, `Edge` as standard instead of custom)?
2. Offense + defense elevens plus six specialist roles, or also full kickoff,
   kick-return, punt and punt-return units? [Default: specialists only.]
3. Should a starter list enforce position shape (e.g., exactly one QB)?
   [Default: no; count cap only, per the shared "no one-of-each" decision.]
