# Plan: BKE-6A Clock and Lineup Foundation

Status: Approved. BKE-6A1 and BKE-6A2 are implemented; BKE-6A3 remains. No production UI or
anchored-game creation is enabled by this phase.

Parent: [PLAN_BKE_6_CLOCK_AND_LINEUPS.md](PLAN_BKE_6_CLOCK_AND_LINEUPS.md)

## 1. Goal

Build the strict, deterministic foundation needed by the later Basketball clock and lineup slices:

- immutable rules schema version 3 and deliberate settings upgrades;
- a versioned setup snapshot that owns the reviewed opening lineup;
- registered clock, stoppage, lineup, substitution, role, and equal-play event contracts;
- pure clock and lineup projection with checked capture commands;
- one additive fixed cloud feature-capability RPC; and
- compatibility proof for rules versions 1-2, clockless Event games, Legacy Basketball, and Soccer.

BKE-6A has no production controls, scheduler, running-clock route guards, Timeline correction UI,
Summary presentation, cloud transport wiring, or release-stage change. Those remain in BKE-6B
through BKE-6E.

## 2. Current-State Audit

The existing architecture supports this work without changing the shared event envelope or stream
version, but six boundaries must be handled explicitly.

1. `BasketballMatchRulesV1` is untagged and `BasketballMatchRulesV2` is exact and permanently
   clockless. `rules.ts`, `profiles.ts`, `settings.ts`, setup drafts, and the database validator all
   currently assume version 2 is the only tagged rules authority.
2. Built-in profiles are immutable version-1 profile records whose rules are version 2. They must
   stay byte-compatible. Anchored mode is an explicit editable-draft upgrade, not a profile rewrite.
3. `BasketballRulesV2Field`, its labels, and its formatter are one compile-time exhaustive diff
   catalog. BKE-6A extends that mechanism in place; it does not add a parallel v3 catalog.
4. `BasketballMatchSetup.version: 1` has participant statuses but no explicit reviewed opening-lineup
   authority or short-handed reason. Anchored setup therefore needs a new setup version while old
   setup snapshots remain byte-compatible.
5. Basketball event definitions currently require `elapsedMs: null`. Anchored gameplay eventually
   needs a non-negative canonical elapsed value, but registry validation has no setup context. The
   envelope layer must admit both forms and the Basketball projector must enforce the rule-specific
   nullability and exact time.
6. `get_basketball_release_capabilities` is parsed by exact shape. It cannot be extended without
   breaking deployed clockless clients. BKE-6A uses a separate fixed RPC and leaves that function
   untouched.

The shared stream, mutation engine, cloud row shape, recorder model, setup-snapshot JSON column,
and `BasketballSportGameState.version` do not require migration. Projection and capture preferences
remain derived/fingerprint-inert; immutable setup and event history remain authoritative.

## 3. Delivery Slices

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-6A1 | Rules v3, setup v2, current-version diff/settings resolution, migration 063 settings validation, fixed capability RPC/client, and compatibility tests | Version 1-2 rules/settings/setup still round-trip exactly; deliberate v3 drafts resolve and persist; the old release RPC remains exact |
| BKE-6A2 | **Implemented.** Clock/stoppage event envelopes, pure anchored-clock projection, checked Start/Pause/Adjust commands, and clockless guards | Deterministic replay proves valid clock histories and fails closed on stale, impossible, or clockless use without any wall-clock UI loop |
| BKE-6A3 | Opening/live lineup state, confirmations, substitutions, roles, equal-play evaluation/override, intervals, checked commands, and full parity audit | Valid lineups and exact running intersections project deterministically; incomplete histories are diagnosed; all prior Basketball/Soccer behavior remains green |

Each slice receives its own implementation branch and PR. Migration 063 belongs only to A1 and is
applied manually after that PR merges. A2 and A3 are TypeScript-only unless implementation discovers
a database constraint that contradicts this audit; such a discovery stops the slice for review.

## 4. Rules and Settings Contract

### 4.1 Strict rules version 3

Add `BasketballMatchRulesV3` with the exact version-2 structural fields plus:

```ts
interface BasketballMatchRulesV3 {
  rulesSchemaVersion: 3
  regulationSegments: BasketballMatchSegmentV2[]
  overtimeTemplate: BasketballOvertimeTemplateV2
  foulWindows: BasketballFoulWindowRule[]
  timeoutPools: BasketballTimeoutPoolRule[]
  personalFoulLimit: number
  clockModel: 'none' | 'anchored'
  clockDisplayDirection: 'count_down' | 'count_up'
  clockExpiration: 'stop_at_zero'
  stoppageMode: 'explicit'
  equalPlayPolicy: {
    mode: 'off' | 'advisory' | 'enforced'
    minimumPeriods: number | null
    maximumConsecutivePeriods: number | null
    maximumPeriodImbalance: number | null
  }
}
```

All objects are exact-key, clone-safe JSON. A non-null equal-play limit must be a positive integer.
`clockModel: 'none'` requires equal-play mode `off`. Anchored mode may use
`off`, `advisory`, or `enforced`. Expiration and stoppage have one supported value in version 3 so
future behavior cannot be inferred from missing fields.

Versions 1 and 2 retain their current parsers and output shape. They never receive defaulted v3
fields during normalization, hydration, projection, or persistence.

### 4.2 One exhaustive field catalog

Replace the version-specific public field type with one current editable field union covering all
version-3 user fields. Preserve temporary compatibility aliases only where they reduce mechanical
churn; new code uses the current name.

The existing label object remains `satisfies Record<BasketballRulesField, string>`, and the existing
formatter remains an exhaustive switch. It must format the structured equal-play policy and clearly
render a field absent from a version-2 source as unavailable rather than inventing a value.

Resolved source metadata may be partial for version-2 rules because v3-only fields do not exist.
Version-3 resolution must provide a source for every field. Profile-upgrade previews compare the
complete current and candidate authorities and cannot hide unchanged inherited structure.

### 4.3 Deliberate upgrade bundle

Built-in profile records and profile versions remain unchanged. Add a pure v2-to-v3 draft upgrade
helper. It copies every version-2 field and adds the complete clock/lineup bundle:

- countdown, stop-at-zero, explicit stoppages;
- `clockModel: 'anchored'`; and
- equal play `off`, except Youth Equal-Play seeds `enforced` with `minimumPeriods: null`,
  `maximumConsecutivePeriods: 2`, and `maximumPeriodImbalance: 1`.

The helper changes only an editable personal, team, or match draft. It never mutates a catalog
profile, saved settings, setup snapshot, active game, or publication.

The five clock/lineup fields are an atomic override bundle. If any is persisted, all five are
persisted. This gives the resolver and database one unambiguous version discriminator while keeping
the existing top-level settings payload shape and generic settings schema version unchanged.
Removing the whole bundle returns the draft to version 2; changing `clockModel` to `none` retains a
valid explicit version-3 bundle with equal play forced off.

Existing structural fields retain their current all-or-none override rule. Match controls may edit
one clock value in memory, but the persisted match override is normalized to the complete effective
bundle before setup review.

### 4.4 Setup snapshot version 2

Keep `BasketballMatchSetupV1` validation and normalized output unchanged for rules versions 1-2.
Add a strict `BasketballMatchSetupV2` for rules version 3 with the same source identity and
participant snapshot plus:

```ts
openingLineups: null | {
  tracked: {
    participantIds: string[]
    shortHandedReason: string | null
  }
  opponent: null | {
    participantIds: string[]
    shortHandedReason: string | null
  }
}
```

`openingLineups` is required and non-null for anchored rules. It is null for version-3 clockless
rules. The tracked ids must exactly match tracked participants marked Starter. Five is normal; one
through four requires a non-empty reason; zero and more than five are invalid. Opponent authority is
optional. When present, it follows the same limits and must match opponent Starter statuses.

Participant ids are unique, stable match ids, ordered by the immutable setup participant order, and
never replaced by cloud player ids. DNP participants are excluded from opening and equal-play
eligibility. Setup version 2 remains JSON in the existing setup-snapshot column, so no table or
transport migration is needed.

## 5. Event Contract

All new families use Basketball event schema version 1 and the existing stream version. Do not bump
existing clockless event schemas merely to add anchored behavior.

| Event | Side | Envelope elapsed | Exact payload authority |
|---|---|---|---|
| `basketball.clock_started` | neutral | current elapsed | `captureCommandId`, `anchorElapsedMs` |
| `basketball.clock_paused` | neutral | resulting elapsed | `captureCommandId`, `elapsedMs`, `source` (`manual`, `expiration`, `period_end`) |
| `basketball.clock_adjusted` | neutral | replacement elapsed | `captureCommandId`, `fromElapsedMs`, `toElapsedMs`, non-empty `reason` |
| `basketball.stoppage` | neutral | pause elapsed | `captureCommandId`, `pauseEventId`, fixed `category`, optional bounded `note` |
| `basketball.lineup_confirmed` | tracked/opponent | current elapsed | `captureCommandId`, `participantIds`, `boundaryPeriodId` |
| `basketball.substitution` | tracked/opponent | current elapsed | `captureCommandId`, complete resulting `participantIds`, `mode`, nullable/required `reason` |
| `basketball.role_changed` | tracked/opponent | current elapsed | `captureCommandId`, non-empty unique participant changes with position/captain values |
| `basketball.equal_play_override` | tracked | current elapsed | `captureCommandId`, `boundaryPeriodId`, candidate ids, exact violation codes, non-empty `reason` |

The clock-start wall anchor is the event's valid ISO `occurredAt`; replay never substitutes
`createdAt`, `updatedAt`, local receipt time, or current device time. Pause plus stoppage share one
capture command and append atomically, with stoppage pointing to the pause event. A stoppage never
creates a timeout, foul, free throw, substitution, or scoring event.

Allowed stoppage categories are `timeout`, `foul_free_throw`, `out_of_bounds`, `substitution`,
`injury`, `official_review`, and `other`. Substitution modes are `balanced`, `exit_only`,
`entry_only`, `boundary`, and `current_lineup_recovery`. Every non-balanced mode requires a reason.

Participant arrays are unique, setup-known, side-correct, and canonicalized to setup order. Event
definitions validate envelope-independent shape; projection validates setup, rules, current period,
clock, eligibility, prior lineup, and relationship semantics.

Lineup confirmation, substitution, role change, equal-play override, and late-participant capture
are paused-clock operations. Their elapsed value must equal the current paused canonical time.

To prepare BKE-6B timestamp capture, existing Basketball event definitions admit either null or a
non-negative integer `elapsedMs`. Projection remains the authority:

- rules versions 1-2 and version-3 clockless streams require null;
- anchored in-period capture requires the exact canonical elapsed value; and
- clock/lineup events are rejected unless rules version 3 is anchored.

This keeps new clockless events readable by deployed clients while old clients fail closed on
unknown anchored event families or non-null anchored gameplay timestamps.

An older client continues to resolve unchanged version-2 saved settings. Persisting any version-3
bundle has a wider deliberate compatibility cost: an un-updated client fails the whole strict
settings parse and cannot start any new Basketball Event game that resolves through that authority,
including a clockless Event game. A personal bundle affects that account's stale devices; a team
bundle affects every stale client attempting team-sourced Event setup for that team. Legacy setup
and continuation/review of existing Event snapshots do not resolve fresh settings and remain
available. The parser must never discard the bundle or silently create a clockless game.

BKE-6B must show this multi-device/team-member consequence before confirming a personal or team
version-3 save. The confirmation is required even when the v3 bundle selects `clockModel: 'none'`,
because the compatibility boundary is the settings schema rather than the selected clock mode.

## 6. Clock Projection and Commands

Add a nullable anchored clock projection containing running state, canonical period-local elapsed
milliseconds, start-anchor `occurredAt`, expiration state, and adjustment/stoppage references.
Clockless projections retain null and otherwise remain byte-equivalent.

Pure replay rules:

1. A started anchored period opens paused at elapsed zero.
2. Start requires the current paused elapsed, a valid active period, and satisfied lineup-start
   guards. It records the event `occurredAt` as the wall anchor.
3. Replay first requires `eventOccurredAt >= anchorOccurredAt`; a negative wall delta is invalid and
   stops at the last coherent projection. For a valid timestamp, unbounded running elapsed is
   `anchorElapsedMs + (eventOccurredAt - anchorOccurredAt)`, and canonical elapsed is that value
   capped at the segment duration.
4. Pause `source` is authoritative, not descriptive. If unbounded elapsed is below the duration,
   `manual` or `period_end` must store that exact uncapped value. If unbounded elapsed reaches or
   exceeds the duration, only `expiration` is valid and it stores exactly the duration. The first
   valid Pause closes that running interval, so a later Pause of any source is stale rather than a
   second expiration materialization. An adjustment below the duration may later create a new
   running interval with its own single closing Pause.
5. Adjustment is paused-only in the persisted result. A checked command first appends Pause when
   necessary, then a reasoned replacement in one atomic command group.
6. Period End requires a paused clock and atomically materializes a Pause first when invoked through
   the future checked UI command. Replay does not infer a missing Pause.
7. A backward wall-clock timestamp, elapsed value outside the segment, duplicate Start/Pause,
   period mismatch, or stale adjustment stops projection at the last coherent state and emits a
   targeted diagnostic.

A pure display helper may derive current visible time from an injected `now`; it never dispatches or
writes. Unlike replay, it clamps an injected time earlier than the anchor to the anchor elapsed and
returns a backward-clock warning for presentation/recovery. It may display the capped period end,
but it never infers or appends the authoritative expiration Pause. BKE-6A tests use explicit ISO
instants and fake timers. The browser scheduler, single expiration materialization on wake/reload,
alerts, and sticky controls remain BKE-6B.

Checked command helpers append through the shared atomic mutation engine and return existing-style
`BasketballCommandResult` failures. A2 provides Start, Pause with optional stoppage, and Set Clock.
No command reads `Date.now()` internally when an explicit test/caller time is supplied.

## 7. Lineup Projection and Equal Play

### 7.1 Side authority and intervals

Anchored projection initializes tracked lineup authority from setup version 2. Opponent lineup
authority remains null unless explicitly enabled in setup. Each enabled side derives:

- current on-court ids and boundary-confirmation state;
- starter, appearance, DNP, position, and captain history;
- period-local on-court intervals;
- running-clock intervals and their intersections;
- exact participation seconds and completeness diagnostics; and
- replacement-required state after disqualification/ejection.

Opening intervals begin at period one elapsed zero but accrue time only while the clock runs. Period
End closes period-local intervals. The next period opens with the previous eligible lineup and
requires confirmation when its segment has `lineupChangeBoundary: true`. A substitution before the
first Start at a boundary invalidates the prior confirmation and requires review again.

One through four on court requires a reasoned event; zero and more than five fail. Ejection and
disqualification mark an on-court participant as replacement-required but do not guess an exit
time. Clock Start remains blocked until an explicit substitution removes that participant.

`Set Current Lineup` is represented by substitution mode `current_lineup_recovery`; it starts a new
known interval at the command time and marks the earlier affected side/period incomplete. Historical
correction UI and consequence previews remain BKE-6C.

Manual-minute events remain projected normally for clockless rules. In anchored rules they remain
valid and visible but do not change participant or team minute totals.

### 7.2 Equal-play evaluator

Equal play applies only to the tracked regulation lineup. Overtimes are excluded unless a future
rules version explicitly adds overtime policy. The eligible opening cohort is tracked Starter and
Bench participants; DNP, ejected, and disqualified participants are excluded. Late participants are
visible but advisory-only for minimum-period and imbalance checks so they never create retroactive
impossibility; maximum-consecutive checks apply after their first credited period.

A participant earns one period credit after any positive running-clock/on-court intersection in
that regulation segment. Before each configured boundary, the evaluator previews the candidate
lineup as participating in the upcoming segment:

- `minimumPeriods` flags exclusion when the remaining regulation opportunities could no longer
  satisfy the participant's minimum;
- `maximumConsecutivePeriods` flags a candidate whose projected consecutive credited-segment streak
  would exceed the limit; and
- `maximumPeriodImbalance` compares projected credited-period counts across the eligible opening
  cohort.

Advisory mode records warnings but permits confirmation. Enforced mode requires an authorized,
reasoned `equal_play_override` immediately before the matching confirmation in the same atomic
capture group. The override stores the exact candidate ids and projector-derived violation codes;
the confirmation consumes it. Dangling, mismatched, duplicate, or reasonless overrides are
diagnostics and block readiness. The client never supplies a boolean that bypasses reevaluation.

Final projection reports both current compliance and whether every enforced violation has a valid
override. The app makes no claim that these three controls implement every league's playing-time
rules.

## 8. Capability and Migration 063

Migration `063_basketball_clock_lineup_foundation.sql` performs only additive or compatible work:

1. extend the private Basketball rule-override validator for the exact atomic v3 bundle and its
   cross-field constraints;
2. preserve all version-2 settings payloads and current save RPC signatures/grants;
3. add authenticated, read-only
   `get_basketball_clock_lineup_capabilities_v1()` returning exactly
   `{ "clockAndLineupsVersion": 1 }` after auth and active-app-access checks;
4. revoke the new function from public/anon and grant only authenticated execution; and
5. notify PostgREST to reload its schema.

The migration must not create or replace `get_basketball_release_capabilities`, change its response,
alter migration 062, widen generic settings RPC grants, or add tables/columns/event constraints.
Static migration tests assert those negative guarantees.

Add an isolated strict client parser/cache for the new RPC. It is account-scoped like the release
capability cache, but has no production call site until BKE-6D. Its exact one-key response rejects
missing, extra, malformed, lower, or future values with typed backend/client/invalid outcomes.

Local-only anchored games do not require this capability. BKE-6D will require both the unchanged
release capability v2 and this fixed feature capability before binding, upload, readiness, or
finalization.

## 9. Compatibility and Failure Boundaries

- Rules versions 1-2, setup version 1, and existing event snapshots normalize without injected
  fields or changed fingerprints.
- Built-in profiles and profile version numbers remain byte-compatible.
- Clockless Basketball continues producing null elapsed values and accepting manual minutes.
- An un-updated client remains compatible with v2 defaults and existing clockless snapshots, but a
  persisted personal/team v3 bundle intentionally blocks every new Event setup that resolves that
  authority until the client updates; BKE-6B must warn before that save.
- Anchored events in a clockless setup fail projection rather than silently becoming clockless.
- Unsupported rules/setup/event versions remain quarantined through existing diagnostics.
- Projection remains last-coherent; checked commands require a complete rebuilt stream.
- Shared event transport remains payload-agnostic and receives no Basketball-specific branch.
- The base release capability, Soccer registries/projectors/settings/capabilities, and Legacy
  Basketball reducer/cloud paths remain untouched.
- No current device preference or release-stage check gates existing local, parked, cloud,
  canonical, or imported games.

## 10. Automated Verification

### BKE-6A1

- exact v1/v2 and setup-v1 fixtures before and after normalization;
- strict v3 valid/invalid, atomic bundle, profile upgrade, clone safety, and round trips;
- one exhaustive field label/formatter/source-diff catalog;
- personal/team/match resolution, saved-default non-upgrade, CAS payload compatibility, and role
  permission parity;
- stale-client strict parsing and setup-authority tests proving a personal/team v3 bundle blocks all
  new Event starts using that authority, including clockless Event intent, without affecting Legacy
  setup or existing Event snapshots;
- setup-v2 opening-lineup validation and setup-v1 fingerprint parity;
- migration 063 exact SQL contract, grants, validator compatibility, and proof that the release RPC
  is not replaced; and
- strict account-isolated feature-capability parsing/cache behavior.

### BKE-6A2

- Start/Pause, duplicate/stale commands, optional atomic stoppage, source-authoritative expiration,
  overdue manual/period-end rejection, one closing Pause per running interval, and Set Clock;
- countdown/count-up display helpers over the same canonical elapsed value;
- fake-time replay across multiple running intervals without real sleeps or per-second events;
- replay rejection versus display-only clamp/warning for negative wall deltas, invalid ISO
  timestamps, segment bounds, period transitions, and last-coherent diagnostics; and
- clock events rejected for every clockless rules/setup fixture.

### BKE-6A3

- five-player, reasoned short-handed, optional opponent, late participant, and setup-order fixtures;
- boundary confirmation, unchanged-five confirmation, balanced/entry/exit/recovery substitution,
  role/captain history, and replacement-required blocking;
- interval intersection and exact seconds across pauses, substitutions, periods, and adjustments;
- equal-play off/advisory/enforced, all three violation families, authorized override consumption,
  late-player handling, and final compliance;
- anchored manual-minute inertness plus clockless manual-minute parity;
- malformed relationship, stale lineup, impossible count, wrong side, duplicate id, and unresolved
  history diagnostics; and
- complete existing Basketball, Soccer, sport-state, parking/fingerprint, cloud, Summary, aggregate,
  settings, build, typecheck, and lint suites.

No test waits on real time, locale formatting, network access, or Supabase runtime state.

## 11. Manual Verification

After A1 merges, apply migration 063 manually and run:

```sql
select public.get_basketball_release_capabilities();
select public.get_basketball_clock_lineup_capabilities_v1();
```

The first response must remain the exact migration-62 contract. The second must return exactly
`{"clockAndLineupsVersion": 1}` for an active authenticated user. Anonymous, inactive, pending, and
suspended access must fail consistently with the base capability.

No live game workflow is manually testable in BKE-6A because no production creation or tracker UI is
enabled. BKE-6B begins browser/PWA clock validation.

## 12. Exit Criteria

BKE-6A is complete only when A1-A3 merge and:

- migration 063 is applied and its two capability responses are verified;
- strict v3 rules and setup-v2 snapshots are supported without rewriting v1/v2/setup-v1 data;
- every approved clock/lineup event is registered and deterministically projected;
- checked foundation commands prove atomic, fail-closed state transitions;
- anchored intervals and equal-play evidence derive without UI or cloud assumptions;
- the full automated compatibility suite is green; and
- docs name BKE-6B, not additional BKE-6A scope, as next.
