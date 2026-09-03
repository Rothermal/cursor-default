# Soccer S19 Team Formation Plan

Status: implementation complete; migration and deployed verification pending

Backlog: `S19` in
[PLAN_SOC_FIELD_TEST_BACKLOG.md](PLAN_SOC_FIELD_TEST_BACKLOG.md)

> **For agentic workers:** Implement this plan by delivery slice and use a
> review checkpoint between slices. Do not add live tactical formations or
> alter match event authority while delivering this plan.

## Goal

Let a Soccer team save one reusable default formation, assign active roster
players to fixed tactical slots, and use those assignments to prefill a new
match lineup without locking the recorder into the default.

The formation is team setup data, not a match event. It helps create the
opening lineup; the existing immutable match setup and later role/substitution
events remain authoritative once the match starts.

## Fixed Decisions

1. Store one active default formation per Soccer team.
2. Support reviewed templates for 11v11, 9v9, and 7v7.
3. Only show templates matching the draft's team-level `Players on field`
   value.
4. Selecting a template explicitly writes its player count into the team
   `maxOnFieldPlayers` rule override in the same draft and CAS save.
5. Templates own fixed slot coordinates, tactical labels, and broad runtime
   roles. Users do not drag or rename slots in this phase.
6. The editor always presents the goalkeeper at the bottom and attacks toward
   the top. This is editor presentation only and does not set match direction.
7. A formation may be saved with empty slots, including an empty goalkeeper
   slot.
8. A roster player may occupy only one slot. Assigning that player elsewhere
   moves the assignment.
9. Changing templates preserves assignments only for exact matching slot ids.
   All other players return to the unassigned list.
10. Removed or inactive roster players remain visibly unavailable until an
    explicit save removes their assignments. They are never applied to match
    setup.
11. Owners/admins edit. Scorers/viewers receive the existing read-only Team
    Manage view.
12. Use explicit Save and Discard controls plus the existing full-draft
    compare-and-swap conflict flow. Do not auto-save or merge slot conflicts.
13. A confirmed Clear Formation action stores `formation: null`; future games
    then use roster-role defaults.
14. The visual pitch has an equivalent compact keyboard-accessible slot list.
    Both surfaces operate on the same draft.
15. Formation assignments prefill starters and broad roles in Player Setup.
    Unassigned active roster players remain selected and default to Bench.
16. A filled slot's broad role overrides that player's roster default for the
    new match. Outside a formation assignment, the roster default from `S11`
    remains the fallback.
17. Player Setup remains editable. The recorder may change Starter/Bench and
    any role before kickoff.
18. A formation/player-count mismatch is not auto-truncated or redistributed.
    Do not apply it; show a clear warning and continue with roster defaults.
19. Formation is prefill-only. Do not add template or slot metadata to
    `SoccerMatchSetup`, events, fingerprints, cloud event rows, Summary, or
    aggregates.
20. Team-setting conflicts use Reload Shared Version or an intentional save of
    the complete current device draft. There is no field-level merge.
21. Multiple named presets, custom dragging, in-match formation changes,
    opponent formations, and heatmaps remain future work.

## Architecture

```text
Team Manage
  Soccer Defaults draft (rules + optional formation)
       |
       | revisioned team settings save
       v
team_sport_settings (soccer team schema v2)
       |
       | load current/cached team settings
       v
Soccer Player Setup + active team roster
       |
       | one-time prefill into existing participant drafts
       v
SoccerMatchSetup participants
       |
       | kickoff
       v
opening_lineup / role / substitution events (unchanged)
```

The formation never becomes a second lineup authority. Once applied to draft
participants, the existing setup flow owns every edit and kickoff validation.

## 1. Formation Domain

### 1.1 Stored shape

Extend the logical team settings model from `{ rules }` to:

```ts
export interface SoccerTeamFormationV1 {
  version: 1
  templateId: SoccerFormationTemplateId
  assignments: Partial<Record<SoccerFormationSlotId, string>>
}

export interface SoccerTeamSettings {
  rules: SoccerMatchRulesOverride
  formation: SoccerTeamFormationV1 | null
}
```

The assignment value is a stable `players.id`, not a participant id,
`team_players` row id, name, number, or embedded roster object. Persist only
filled slots. An empty formation draft serializes empty assignments; clearing
the feature serializes `formation: null`.

Do not persist coordinates, labels, broad roles, or player count. Those are
immutable catalog data resolved by `templateId`. This prevents saved teams
from carrying stale geometry or redefining runtime roles.

### 1.2 Template catalog

Add a pure catalog under `src/lib/soccer/formation.ts`.

| Size | Template | Slots |
|---|---|---|
| 11 | `11v11-4-3-3` | `gk`; `lb,lcb,rcb,rb`; `lcm,cm,rcm`; `lw,st,rw` |
| 11 | `11v11-4-4-2` | `gk`; `lb,lcb,rcb,rb`; `lm,lcm,rcm,rm`; `lst,rst` |
| 11 | `11v11-3-4-3` | `gk`; `lcb,cb,rcb`; `lm,lcm,rcm,rm`; `lw,st,rw` |
| 9 | `9v9-3-3-2` | `gk`; `lcb,cb,rcb`; `lm,cm,rm`; `lst,rst` |
| 9 | `9v9-3-2-3` | `gk`; `lcb,cb,rcb`; `lcm,rcm`; `lw,st,rw` |
| 9 | `9v9-2-3-3` | `gk`; `lcb,rcb`; `lm,cm,rm`; `lw,st,rw` |
| 7 | `7v7-2-3-1` | `gk`; `lcb,rcb`; `lm,cm,rm`; `st` |
| 7 | `7v7-3-2-1` | `gk`; `lcb,cb,rcb`; `lcm,rcm`; `st` |
| 7 | `7v7-2-2-2` | `gk`; `lcb,rcb`; `lcm,rcm`; `lst,rst` |

Every slot definition includes:

- stable slot id;
- short tactical label (`GK`, `LB`, `LCB`, `CM`, `RW`, and so on);
- one broad `SoccerRoleGroup` (`goalkeeper`, `defender`, `midfielder`, or
  `forward`); and
- normalized editor coordinates with goalkeeper near `y = 1` and attack near
  `y = 0`.

Formation coordinates are an editor-only coordinate space. They are never a
`GameEventLocation`, never pass through `soccerFieldLocation`, and must not be
reused as match-field event coordinates; formation attack runs along the
editor's vertical axis independently of match direction.

Catalog invariants:

- slot count equals template player count;
- exactly one goalkeeper slot exists;
- slot ids and coordinates are unique within a template;
- coordinates are finite and within `[0, 1]`;
- no `custom` runtime role appears;
- template ids and template ordering are deterministic.

### 1.3 Pure draft transitions

Keep editor behavior outside React:

- assign a player to a slot and remove their previous assignment atomically;
- clear one slot;
- switch template and retain only exact matching slot ids;
- identify assignments whose player is not on the active roster;
- produce a save candidate that removes unavailable assignments only after
  explicit Save;
- clear the complete formation; and
- apply a valid formation to roster drafts once.

All helpers clone inputs and return deterministic results. The visual pitch and
accessible list call the same transitions.

## 2. Settings Compatibility And Storage

### 2.1 Split personal and team schema constants

The current `SOCCER_SETTINGS_SCHEMA_VERSION = 1` is shared by personal and team
settings. Do not bump personal settings merely to add a team-only feature.

Introduce separate constants:

```ts
SOCCER_PERSONAL_SETTINGS_SCHEMA_VERSION = 1
SOCCER_TEAM_SETTINGS_SCHEMA_VERSION = 2
```

Compatibility rules:

- personal version 1 remains exactly `{ rules, display }`;
- team version 1 remains readable as legacy `{ rules }` and normalizes in
  memory to `{ rules, formation: null }`;
- team version 2 is exactly `{ rules, formation }`;
- every new team save writes version 2;
- existing rows are not bulk rewritten; the first explicit save upgrades one
  row through the existing revisioned endpoint; and
- unsupported or malformed versions continue to fail closed.

Update team cloud/cache adapters so a valid version-1 row can be consumed and
cached as the current logical model without confusing it with personal schema
version 1. Keep pending/conflict revisions intact.

### 2.2 Database migration

Use the next available migration number (currently expected to be `065`) to
replace the Soccer settings validator while retaining the existing fixed RPC
surface.

The migration must:

- continue accepting personal Soccer schema version 1 only;
- continue accepting legacy team schema version 1 `{ rules }` from an old
  client;
- accept team schema version 2 only when `rules` and `formation` are the exact
  top-level keys;
- validate `formation: null` or exact formation version/template/assignments;
- enforce known template ids and slot ids, matching slot membership, UUID
  player values, and unique player assignments;
- reject unknown keys, unsupported versions, duplicate player assignment, and
  malformed ids;
- keep owner/admin save authority and scorer/viewer read-only behavior in the
  existing RPC; and
- add coarse `formation` to audit `changed_fields` when the formation changes,
  without recording player ids, names, slot values, or the full settings JSON.

The server does not need to prove current roster membership during immutable
payload validation. Formation is not authorization or match authority. Client
readers cross-check active team roster membership before display/application,
and stale ids remain repairable.

### 2.3 Copy and conflict behavior

The existing Copy Team Defaults action must copy `rules` only. It preserves the
target team's formation because source player ids belong to another team. This
applies to both current `setDraft` branches: a successfully parsed source
replaces only `draft.rules`, while a source with no saved settings replaces
`draft.rules` with `{}`. Neither branch replaces or clears `draft.formation`.
Copying rules that changes `maxOnFieldPlayers` may leave the target formation
mismatched; show that warning and offer a compatible template or Clear
Formation. Saving the rule change remains allowed, and match setup will not
apply the mismatched formation.

Dirty detection must fingerprint the complete logical team settings object,
not only `draft.rules`. Reload Shared Version replaces both rules and
formation. Discard restores both. Keep the existing full-record CAS semantics;
do not merge rules and slots from competing revisions.

## 3. Team Manage Editor

Add `Rules | Formation` tabs inside the existing Soccer Defaults section so
the page does not become one long settings form.

### 3.1 Template selection

- Show a 11v11 / 9v9 / 7v7 size control. Choosing a size updates
  `draft.rules.maxOnFieldPlayers`, then shows only templates for that count.
- Selecting a template also ensures `draft.rules.maxOnFieldPlayers` matches
  its count in the same unsaved draft.
- If rule copying or another draft edit creates a mismatch, retain the
  formation visibly, warn, and offer a matching template or Clear. Saving the
  rules remains possible because Player Setup already fails safely on mismatch.
- Switching templates retains exact matching slot ids only.

### 3.2 Assignment interaction

Render a restrained Soccer pitch with fixed slot buttons. Selecting a slot
opens a compact roster picker with active players plus Clear Slot. The current
player, jersey number, and tactical label fit without resizing the pitch.

Below the pitch, render a slot list in deterministic goalkeeper-to-forward
order. Each row exposes the same label, broad role, assignment, choose/change,
and clear operations. The list is keyboard-operable and is not a different
editor state.

When assigning a player already used elsewhere, move them and announce the
previous slot change. Unassigned active roster players remain available in the
picker. Do not render drag-only behavior.

### 3.3 Incomplete and stale state

- Empty slots are ordinary draft state, not errors.
- An unavailable player id renders as `Player unavailable` in its saved slot.
- Opening the editor does not mutate or hide that assignment.
- The next explicit successful Save from the Formation tab drops unavailable
  assignments and states that cleanup in the confirmation/summary. An
  unrelated Rules-tab save does not silently clean formation assignments.
- An empty goalkeeper slot may save; Player Setup still requires exactly one
  starting goalkeeper before kickoff.

Clear Formation requires confirmation and modifies only the local draft until
Save. Discard restores the server/cache version.

### 3.4 Permissions

Owners/admins receive slot, template, Save, Discard, and Clear controls.
Scorers/viewers see the selected template, pitch, slot list, empty assignments,
and unavailable labels without edit controls. Preserve the existing settings
RPC and Team RLS boundaries.

## 4. Match Setup Prefill

### 4.1 Loading

`SoccerGameSetup` already loads the selected team's settings for rule
inheritance. `SoccerPlayerSetup` should consume the current/cached team
formation through the existing team-settings controller while it loads the
active roster.

Apply formation only when all are true:

- the match uses a cloud Soccer team;
- this is a new, untouched pre-kickoff participant setup;
- team settings produced a valid formation;
- the formation template count equals
  `setup.rulesSnapshot.maxOnFieldPlayers`; and
- roster and settings loading have reached a coherent success/cached state.

Apply once. A hook refresh, focus event, parent render, or later team-settings
change must not overwrite recorder edits.

### 4.2 Mapping

For each active roster player:

- assigned to a valid slot: selected, `starter`, and `initialRole` set to
  `{ group: <slot role group>, label: null }`;
- unassigned: selected, `bench`, role from `team_players.position` via `S11`;
- assigned by stale/unavailable id: no participant is fabricated and the
  remaining valid assignments may still apply; show a repair warning; and
- duplicate/malformed assignments: reject the formation before application
  and use roster defaults.

A slot's tactical label and id are editor presentation only. Never copy either
into a participant, including `initialRole.label`; this prevents formation
metadata from flowing through `soccer.opening_lineup` into immutable event rows.

The setup remains editable. Existing max-starter, exact-one-goalkeeper,
short-handed confirmation, and kickoff checks remain authoritative.

### 4.3 Mismatch and fallback

On count mismatch, do not partially apply, truncate, or choose another
template. Show the saved template count and current match count, then initialize
from roster defaults. The recorder can continue manually; Team Manage is the
place to repair the shared default.

If team settings are unavailable and no valid cache exists, preserve the
current roster-default flow and show the existing settings warning. Do not
block a local fallback match solely because formation could not load.

### 4.4 Authority boundary

After the one-time draft mapping, persist only the existing
`SoccerMatchParticipant` fields. Do not add formation to:

- `SoccerMatchSetup` or its schema version;
- event payloads or actors;
- sync/setup fingerprints;
- canonical publication;
- Timeline, Summary, season aggregates, or player aggregates; or
- live Role/Substitution commands.

This lets a player start at formation Forward, move to Midfielder during the
match, and return to the saved team formation in a future match without any
write-back from live play.

## 5. Delivery Slices

```text
S19A  Domain + settings schema [implemented]
      Template catalog, strict model/parsers, pure draft/application helpers,
      team schema v1->v2 compatibility, migration, cache/RPC/audit tests

S19B  Team Manage editor [implemented]
      Rules/Formation tabs, visual pitch, accessible slot list, picker,
      stale-player repair, read-only view, full-draft CAS/save/discard/clear

S19C  Match setup prefill [implemented]
      Coherent roster/settings load, one-time starter/role mapping,
      mismatch/stale warnings, regression docs and plan completion
```

Each slice should use its own feature branch and PR. Migration `065` must be
applied before or atomically with the S19A application deploy: from S19A onward,
every Soccer team-settings save writes schema version 2 and an unmigrated
backend rejects it. `S19C` must not merge before both readers and the editor can
round-trip the formation.

S19A is implemented through migration `065`. Its verification map is
[`REGRESSION_SOC_S19A_FORMATION_FOUNDATION.md`](REGRESSION_SOC_S19A_FORMATION_FOUNDATION.md).
S19B is implemented in Team Manage and S19C implements one-time Player Setup
prefill. Migration `065` remains a hard deployment prerequisite for current
team-setting saves and formation round-trip verification.

## 6. File Map

### S19A

- `src/lib/soccer/formation.ts` and tests
- `src/lib/soccer/settings.ts` and tests
- `src/lib/soccer/teamSettingsSync.ts` and tests
- `src/hooks/useSoccerTeamSettings.ts` and tests
- `src/lib/sportSettingsCloud.ts` only if split schema constants require a
  narrow adapter change
- next available `supabase/migrations/*_soccer_team_formation.sql`
- matching migration contract test

### S19B

- `src/components/settings/SoccerTeamSettingsPanel.tsx`
- new focused components under `src/components/soccer/` or
  `src/components/settings/` for pitch, slot list, and picker
- `src/pages/Teams.tsx` only for active-roster data plumbing if the panel does
  not already receive enough roster context
- focused editor transition/wiring tests

Implemented with `SoccerFormationEditor`, Rules/Formation tabs, positively
verified active-roster plumbing, explicit save-time stale-assignment cleanup,
read-only rendering, and the existing full-draft CAS controls. See
[`REGRESSION_SOC_S19B_FORMATION_EDITOR.md`](REGRESSION_SOC_S19B_FORMATION_EDITOR.md).

### S19C

- `src/pages/SoccerPlayerSetup.tsx`
- `src/hooks/useSoccerTeamSettings.ts` only if setup needs a narrower
  read-only activation mode
- formation application tests
- `docs/PLAN_SOC_FIELD_TEST_BACKLOG.md`
- `docs/REGRESSION_TESTING.md`
- `docs/AGENT_CODEBASE_OVERVIEW.md` and `AGENTS.md` after implementation

Implemented with a tested one-time readiness decision, independent cached/cloud
team-settings consumption, coherent active-roster role loading, editable
starter/broad-role mapping, and visible mismatch, unavailable-player, and
settings-fallback notices. See
[`REGRESSION_SOC_S19C_SETUP_PREFILL.md`](REGRESSION_SOC_S19C_SETUP_PREFILL.md).

## 7. Automated Coverage

### Domain

- every catalog template satisfies count, goalkeeper, slot-id, role, and
  coordinate invariants;
- template lookup and ordering are deterministic;
- assign moves a duplicate player rather than duplicating them;
- template switch preserves only exact shared slot ids;
- clear slot and Clear Formation do not mutate inputs;
- unavailable roster assignments are reported and removed only by explicit
  save preparation;
- partial formations, including empty goalkeeper, remain valid;
- application maps assigned players to starter/slot broad role with
  `initialRole.label === null`, never copies the slot label/id, and maps
  unassigned players to bench/roster role; and
- mismatch, malformed, and duplicate formation data never partially apply.

### Settings and SQL

- personal schema version 1 remains unchanged;
- team schema version 1 reads as `formation: null`;
- team schema version 2 round-trips exact formation data;
- unknown keys/templates/slots, non-UUID player ids, and duplicate players
  fail in TypeScript and SQL validators;
- old cached/cloud rows remain usable and first explicit save upgrades to
  version 2;
- conflict/reload/discard replace the whole formation draft;
- both cross-team Copy branches (saved source and no-settings source) copy only
  rules and preserve the target formation;
- audit metadata records only coarse `formation` change; and
- owner/admin write and scorer/viewer read-only behavior remains unchanged.

### UI and setup

- only templates matching the explicit player count appear;
- selecting a template sets the team count override in the same draft;
- pitch and list operate on one state and expose accessible names;
- duplicate assignment moves the player and announces the move;
- unavailable rows remain visible before Save and disappear after successful
  cleanup save;
- read-only users cannot open pickers or save/clear;
- prefill runs once for a fresh team setup and never resets manual edits;
- mismatched formation shows a warning and uses roster defaults;
- stale players are not fabricated;
- every formation-prefilled participant has `initialRole.label === null`; and
- existing non-formation Soccer setup/kickoff tests remain green.

## 8. Manual Regression

1. As owner/admin, choose each 11v11, 9v9, and 7v7 template and confirm the
   team player-count override changes with it.
2. Assign one player twice and confirm the player moves to the new slot.
3. Switch between templates and confirm only exact shared slot ids retain
   assignments.
4. Save a partial formation, reload Team Manage, and confirm exact round-trip.
5. Open as scorer/viewer and confirm pitch/list are visible but read-only.
6. Remove/deactivate an assigned roster player, reopen Formation, and confirm
   unavailable display; save and confirm cleanup.
7. Trigger a two-device settings revision conflict and verify Reload Shared
   Version restores the complete cloud formation.
8. Start a matching-count team game and confirm assigned players become
   starters with slot roles while unassigned players are Bench with roster
   roles.
9. Change lineup statuses/roles before kickoff and confirm no refresh resets
   them.
10. Create a mismatch through match rules and confirm no formation assignment
    applies, the warning is clear, and manual setup remains possible.
11. Kick off, substitute, and change roles; confirm Team Manage defaults do not
    change.
12. Clear Formation, save, start another match, and confirm normal `S11`
    roster-role behavior.

## 9. Exit Criteria

- The migration is applied and both legacy team v1 and current team v2 rows
  load safely.
- All nine templates satisfy catalog invariants.
- Team formation save, discard, clear, stale-player repair, read-only access,
  and CAS conflict handling pass.
- Matching fresh setups prefill exactly once; mismatches and unavailable
  players fail safely without blocking manual lineup creation.
- Match setup/event/cloud/finalization schemas are unchanged.
- Focused tests, full tests, lint, typecheck, production build, and the manual
  regression matrix pass.

## 10. Deferred Follow-ups

- Multiple named formation presets
- User-defined formations, labels, and draggable coordinates
- In-match formation/tactical board and formation-change history
- Opponent formations
- Position heatmaps or minutes by tactical slot
- Writing live substitutions or role changes back to team defaults
- Formation metadata in Summary or aggregates
