# SOC-S23 - Team lineup status defaults

**Status:** approved; implementation pending
**Scope:** Soccer team settings, Team Manage, and fresh Soccer Player Setup drafts
**Depends on:** SOC-6D team settings, S11 roster roles, and S19 team formations

## 1. Goal

Let a Soccer team remember its normal starters independently from its saved
formation. This reduces repeated pre-match setup while preserving the match
draft and event stream as the only authorities after setup begins.

The default belongs to one player's membership context on one Soccer team. It
does not change the global player identity, create a live substitution, or
write match edits back to team settings.

## 2. Approved decisions

1. Store lineup defaults in versioned Soccer team settings, keyed by stable
   player id.
2. Persist only the normal starter ids. Every other active roster player
   defaults to Bench.
3. Team defaults support Starter and Bench only. DNP remains match-specific.
4. A valid applicable saved formation owns the complete starter set. Standalone
   lineup defaults apply only when a formation is not applied.
5. A missing or non-applicable formation, including player-count mismatch or
   unavailable assignments, visibly falls back to standalone lineup defaults.
6. Defaults apply once to a fresh editable Player Setup draft. Later team
   changes never rewrite that draft.
7. Inactive roster members are ignored during setup but retain their stored
   starter status for later reactivation.
8. Deleted or unrelated ids are ignored with a visible warning and are removed
   only by an explicit owner/admin save from the lineup-default editor.
9. Owner/admin users edit. Scorers/viewers receive read-only review.
10. Team Manage uses a separate **Lineup Defaults** tab with compact
    Starter/Bench controls, starter count, and existing Save/Discard behavior.
11. The editor groups Starter and Bench players, then sorts each group by
    Soccer role, numeric-aware jersey number, display name, and stable id.
12. Invalid lineup combinations may be saved with warnings. Player Setup
    applies them exactly and keeps existing kickoff validation authoritative.
13. Cross-team rules copy never copies or clears player-specific lineup
    defaults.
14. Audit metadata records only the coarse `lineup_defaults` changed field;
    it does not include player names or ids.

## 3. Authority model

```text
team Soccer settings
  rules
  formation
  lineup defaults: stable starter ids
          |
          v
fresh editable Player Setup draft
  valid formation applied? ---- yes ---> formation owns starters + roles
          |
          no
          v
  active roster intersect starter ids ---> Starter / Bench prefill
          |
          v
manual match edits ---> immutable opening lineup ---> live events
```

The team default is setup input only. Once the one-time prefill decision is
made, changing team settings, roster activity, formation, or default roles
cannot mutate the match draft or an opened match.

## 4. Data contract

### 4.1 Team settings schema version 3

Extend the exact Soccer team-settings payload without changing personal
settings:

```ts
interface SoccerTeamLineupDefaultsV1 {
  version: 1
  starterPlayerIds: string[]
}

interface SoccerTeamSettings {
  rules: SoccerMatchRulesOverride
  formation: SoccerTeamFormationV1 | null
  lineupDefaults: SoccerTeamLineupDefaultsV1
}
```

The stored ids must be UUIDs, unique, deterministically ordered, and bounded to
a defensive maximum. The payload stores no names, jersey numbers, roles,
active-state mirrors, or bench ids.

Schema compatibility is additive in memory:

- team schema version 1 reads as existing rules plus no formation and an empty
  starter list;
- team schema version 2 preserves its formation and gains an empty starter
  list;
- team schema version 3 requires the exact `rules`, `formation`, and
  `lineupDefaults` shape;
- the first explicit save writes schema version 3.

An empty starter list means every active player defaults to Bench. It is valid
and does not imply DNP.

### 4.2 Validation versus roster state

TypeScript and SQL validate the exact shape, UUIDs, uniqueness, bounds, and
version. They do not make the settings row corrupt merely because a roster
membership later becomes inactive or disappears.

Structurally malformed or unsupported whole settings records retain the
existing SOC-6D fail-closed behavior. "Invalid formation" in setup means a
strictly parsed formation that cannot be applied to the current rules or
roster; S23 does not partially trust arbitrary malformed settings JSON.

Roster reconciliation is explicit and non-authoritative:

- active stored starter -> editable Starter;
- inactive team member -> retained but omitted from active setup/editor groups;
- missing or unrelated id -> warning and ignored;
- explicit save from **Lineup Defaults** -> removes missing/unrelated ids while
  retaining known inactive team members.

The UI therefore needs the active roster for display and the complete team
membership-id set for retention. No player identity is fabricated from a stale
settings id.

### 4.3 Fingerprints, copy, and audit

Team-settings fingerprints and full-record CAS include lineup defaults. Reload,
discard, conflict resolution, and cloud replacement operate on the complete
schema-v3 record.

`copySoccerTeamRules` continues to replace only `rules`; it preserves the
target team's formation and lineup defaults. Audit changed fields may include
`lineup_defaults` but never the stored ids.

## 5. Team Manage behavior

Add **Lineup Defaults** as the third keyboard-operable tab beside Rules and
Formation. Keep one shared draft and one Save/Discard boundary across all tabs.

The lineup tab shows:

- active team players only;
- a stable Starter/Bench segmented control per player;
- `Starters X / maxOnFieldPlayers` from the effective draft rules;
- separate Starter and Bench groups;
- role, jersey, and name context, ordered Forward, Midfielder, Defender,
  Goalkeeper, then Custom within each status group;
- warnings for zero starters, excess starters, and goalkeeper mismatch;
- a count warning for missing/unrelated stored ids; and
- read-only presentation without mutation controls for scorer/viewer users.

Warnings do not block save. The team roster can temporarily be incomplete, and
future rule or roster changes can make a previously sensible default invalid.
Automatic demotion would hide that drift and choose players without authority.

Changing a lineup default never changes formation slot assignments. Changing
or clearing a formation never changes lineup defaults.

## 6. Player Setup behavior

Extend the existing one-time S19 prefill decision rather than adding a second
effect that can race or overwrite manual edits.

For a fresh existing-team Soccer setup:

1. Wait for the coherent active roster, roster roles, and team-settings result
   already required by S19.
2. Attempt to apply the saved formation.
3. If the formation applies, use its assigned starters and roles exactly as
   today. Standalone lineup defaults do not supplement unassigned slots.
4. If no formation applies, intersect stored starter ids with the active match
   roster and assign Starter or Bench. Preserve each player's S11 roster role.
5. Report stale ids and the reason a formation fell back when applicable.
6. Mark prefill resolved once. Reloads and later async updates must not reset
   user edits.

Every active roster player remains selected for the match unless the recorder
changes the match roster. Existing max-player, exactly-one-starting-goalkeeper,
and short-handed confirmation checks remain the kickoff authority.

Local/personal games and unavailable team settings retain the current editable
all-Bench setup behavior. No new field enters `SoccerMatchSetup`, participants,
events, cloud binding, summary, aggregates, parking fingerprints, or recovery
exports.

## 7. Implementation slices

```text
S23A  Settings foundation
      Pure lineup-default model/helpers, team schema v1/v2 -> v3 readers,
      strict parsers/fingerprints/copy/save preparation, migration 068,
      cloud/cache/CAS/audit compatibility, focused contract tests

S23B  Team Manage editor
      Third settings tab, grouped role-aware roster controls, counts/warnings,
      inactive retention, explicit stale-id cleanup, read-only role behavior,
      focused UI/controller regression

S23C  Player Setup prefill
      One-time formation-first precedence, standalone fallback, stale/mismatch
      notices, editable kickoff validation, docs and final regression coverage
```

Each slice uses its own feature branch and PR. Migration 068 must be applied
before or with the S23A client deployment because S23A saves schema version 3.
S23B and S23C begin only after v1, v2, and v3 settings round-trip safely.

## 8. File map

### S23A

- new focused lineup-default module under `src/lib/soccer/`
- `src/lib/soccer/settings.ts` and tests
- `src/lib/soccer/teamSettingsSync.ts` and tests
- `src/hooks/useSoccerTeamSettings.ts` where schema constants are consumed
- `supabase/migrations/068_soccer_lineup_status_defaults.sql`
- migration contract test
- focused S23A regression document

### S23B

- `src/components/settings/SoccerTeamSettingsPanel.tsx`
- new focused lineup-default editor component
- `src/pages/Teams.tsx` for active and complete membership data plumbing
- editor ordering, warning, cleanup, access, and wiring tests
- focused S23B regression document

### S23C

- `src/pages/SoccerPlayerSetup.tsx`
- pure prefill helper tests
- existing S19 formation application tests where precedence is shared
- field-test backlog, regression index, overview, and agent notes
- focused S23C regression document

## 9. Automated coverage

### Domain and settings

- schema v1 and v2 upgrade in memory without mutation;
- schema v3 exact parsing and deterministic round-trip;
- duplicate, malformed, oversized, and non-UUID starter lists fail closed;
- sparse starters imply Bench for every other active roster member;
- inactive ids survive explicit saves while missing ids require explicit
  lineup-tab cleanup;
- copy preserves target formation and lineup defaults;
- fingerprints, cache, CAS conflicts, reload, and discard include the new data;
- SQL and TypeScript validators agree; and
- audit metadata is coarse.

### Team Manage

- owner/admin edit and scorer/viewer read-only behavior;
- tab keyboard navigation includes the third tab;
- Starter/Bench grouping and role/jersey/name ordering are deterministic;
- starter, maximum, and goalkeeper warnings do not block save;
- inactive entries remain stored and absent from active groups;
- stale entries are announced and removed only by explicit save; and
- formation edits never mutate lineup defaults and vice versa.

### Player Setup

- valid formation wins completely;
- missing, invalid, mismatched, or unavailable formation falls back visibly;
- standalone defaults intersect the active roster and preserve S11 roles;
- stale and inactive ids never fabricate participants;
- prefill runs once and never overwrites manual edits;
- invalid prefill remains editable and existing kickoff validation blocks it;
- local/personal and unavailable-settings paths retain current behavior; and
- setup, event, cloud, summary, aggregate, and parking schemas remain unchanged.

## 10. Manual regression

1. Save a normal starting group, reload Team Manage, and confirm exact status,
   order, count, and role presentation.
2. Open as scorer/viewer and confirm the tab is visible but read-only.
3. Deactivate a saved starter, save an unrelated rule, reactivate the player,
   and confirm Starter returns.
4. Permanently delete an otherwise eligible disposable player, confirm the
   stale warning, explicitly save the lineup tab, and confirm cleanup.
5. Trigger a two-session revision conflict and confirm cloud/device choices
   replace the whole rules/formation/lineup draft.
6. Start a team match without a formation and confirm the saved starters and
   roster roles prefill once.
7. Save a valid formation with a different starter group and confirm formation
   wins completely.
8. Make the formation incompatible with match rules and confirm standalone
   defaults apply with a visible fallback notice.
9. Save too many starters or an invalid goalkeeper combination; confirm Team
   Manage warns, Player Setup applies exactly, and kickoff requires correction.
10. Edit match statuses, kick off, substitute, and change roles; confirm team
    defaults remain unchanged.
11. Copy rules from another Soccer team and confirm neither team's player-
    specific lineup defaults cross the boundary.

## 11. Exit criteria

- Migration 068 is applied and schema versions 1, 2, and 3 load safely.
- Team settings preserve lineup defaults through save, cache, conflict, and
  audit paths without leaking player ids into audit metadata.
- Team Manage supports accessible owner/admin editing and scorer/viewer review.
- Fresh Player Setup applies exactly one formation-first prefill decision.
- Existing kickoff, event, cloud, finalization, summary, aggregate, parking,
  import/export, and recovery contracts remain unchanged.
- Focused tests, full tests, lint, typecheck, production build, and the manual
  regression matrix pass.

## 12. Deferred follow-ups

- S24 in-match saved-formation application
- multiple named formation or lineup presets
- opponent lineup defaults
- team-level DNP defaults
- automatic starter rotation or equal-play recommendations
- writing match lineup changes back to team defaults
- cross-sport lineup-default schemas
