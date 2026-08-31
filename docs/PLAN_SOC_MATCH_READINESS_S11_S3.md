# Soccer Match Readiness: Default Roles and Field Priority

Status: implemented

Backlog: `S11` and `S3` in
[PLAN_SOC_FIELD_TEST_BACKLOG.md](PLAN_SOC_FIELD_TEST_BACKLOG.md)

## Goal

Remove two high-friction steps before the next live match:

- let a Soccer team roster carry each player's normal role into new match setup; and
- keep the live pitch high in the Field tab while retaining complete marker review controls.

## Fixed decisions

1. A default role belongs to the team roster entry, not permanent player identity.
2. Reuse `team_players.position`; no migration is required.
3. Stored Soccer defaults use strict values: `soccer:goalkeeper`, `soccer:defender`,
   `soccer:midfielder`, or `soccer:forward`.
4. Null, legacy free text, and unknown values fall back to Midfielder.
5. Owners/admins set the default in team roster management. New roster entries default to
   Midfielder.
6. Match setup may override the role, including Custom, without writing back to the roster.
7. Existing setup snapshots and in-game `soccer.role_changed` events remain authoritative for that
   match.
8. Side, player, and capture mode remain above the pitch. Quick capture stays immediately below it.
9. Marker family, side, and period are review-only controls in a collapsed section below the pitch.
10. Marker filtering semantics, field coordinates, event schemas, and Soccer release policy do not
    change.
11. Legacy free-text positions remain byte-for-byte unchanged until a manager explicitly changes
    the Soccer role control; read fallback does not silently become a write migration.

## Implementation

### S11 - team roster default role

- Add a strict parse/serialize helper under `src/lib/soccer/`.
- Read and write `team_players.position` in the existing Teams roster editor.
- Keep the existing merge-player conflict editor sport-aware: Soccer rows show strict role labels
  and options, while untouched raw legacy values pass through unchanged.
- Show the role selector only for Soccer teams and only to users who may manage the roster.
- Include `position` in the Soccer cloud-roster query and prefill `initialRole` for newly loaded
  participants.
- Preserve roles already frozen into an existing match setup.
- Reuse an already-loaded local roster when offline and expose Retry when the required cloud roster
  cannot be loaded.

### S3 - prioritize the field

- Render `SoccerField` immediately after live side/player/capture controls.
- Keep Goal/Foul/Card/Team quick capture immediately below the field.
- Move marker filters into a native collapsed disclosure below quick capture.
- Include the active family/side/period scope in the collapsed disclosure summary.
- Preserve all current filter values and marker projection behavior.

## Acceptance

- A Soccer roster manager can set one of four default roles for every active player.
- A new cloud-team Soccer match prefills each participant from that team-scoped default.
- Missing or malformed role data safely displays and prefills Midfielder.
- Saving only a name or jersey number does not normalize an untouched legacy position value.
- Changing a role in setup or during a game does not alter the team default.
- Basketball and other sports do not show or interpret the Soccer role control.
- On the Field tab, the pitch appears before marker review filters.
- Marker filters remain reachable, keyboard-operable, and collapsed by default.
- Focused tests, full tests, lint, typecheck, and production build pass.

## Out of scope

- Formation storage or a team lineup board (`S19`)
- Persisting Custom role labels as defaults
- Writing match role changes back to the roster
- Substitution quick action (`S2`)
- Restart capture or other field-shell backlog items
