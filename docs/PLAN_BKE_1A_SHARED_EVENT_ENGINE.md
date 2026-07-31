# Plan: BKE-1A Shared Event Engine

Behavior-preserving shared-engine work required before Basketball can register state or events.

Status: Ready for implementation. The focused implementation review found no unresolved product
decision; the contracts below apply the approved BKE-0 architecture.

Parent: [PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md](PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md)

---

## 1. Goal

Remove the remaining Soccer-only ownership from generic game state, allow event definitions to opt
into a neutral team side, and provide one all-or-nothing mutation primitive for linked event edits.

BKE-1A exits when:

- generic loaders and fingerprints dispatch sport state through a sport-neutral module;
- Soccer normalizes and fingerprints equivalent authoritative content;
- the generic envelope accepts `neutral` while existing Soccer definitions still reject it;
- multiple update/delete/restore revisions can be committed atomically with one projection rebuild;
- a failed batch returns the original state without a partial revision; and
- all existing Soccer and legacy Basketball tests remain green.

## 2. Boundaries

### Included

- Add `src/lib/sportGameState/` as the neutral home for the `SportGameState` union, normalization
  dispatch, and fingerprint projection.
- Rename the Soccer-specific normalizer and keep Soccer creation/validation in `src/lib/soccer/`.
- Move app-wide imports in core types, persistence, reducer, context, and fingerprint code to the
  neutral module.
- Make aggregate sync eligibility capability-shaped: no event stream and no sport-owned state.
- Widen `GameEventTeamSide` to `tracked | opponent | neutral`.
- Add definition-scoped allowed-side validation with a compatibility default of
  `tracked | opponent`.
- Add `applyGameEventMutations` for atomic update/delete/restore batches.
- Add focused unit and regression coverage.
- Update architecture and regression documentation after implementation.

### Excluded

- Basketball setup, event definitions, projector, reducer actions, or UI.
- A Basketball member in the `SportGameState` union; BKE-1B adds it.
- Switching any Soccer capture or Timeline call site to the batch API.
- Adding `add` to the new mutation primitive; `addGameEvents` remains the atomic append API.
- Database constraint changes. The `game_events.team_side` constraint widens in BKE-4A when the
  generalized cloud layer is ready.
- Basketball cloud eligibility, transport, finalization, Summary, aggregates, or rollout gates.
- Changes to legacy aggregate action behavior.

## 3. Sport-State Extraction

Create a neutral module with this ownership:

```text
src/lib/sportGameState/
  types.ts   # SportGameState discriminated union
  state.ts   # normalizeSportGameState dispatch + fingerprint projection
```

The initial union contains only `SoccerSportGameState`. BKE-1B adds
`BasketballSportGameState`; no placeholder Basketball object is introduced in 1A.

`src/lib/soccer/state.ts` exports `normalizeSoccerSportGameState(value)` and remains responsible
for Soccer version migration, setup validation, default projection creation, and capture preference
normalization. The neutral dispatcher:

1. checks that the value is an object with a string `sportId`;
2. dispatches `soccer` to the Soccer normalizer;
3. returns `null` for unknown sports in BKE-1A; and
4. never guesses a sport from the active `GameState.sport` value.

Core consumers move from `lib/soccer/state` to `lib/sportGameState/state`:

- `src/types.ts` for `SportGameState` (from `lib/sportGameState/types`);
- `src/context/GameContext.tsx` for persisted-state normalization;
- `src/lib/gameParking.ts` for parking/import validation;
- `src/lib/gameReducer.ts` for loaded/replaced state normalization; and
- `src/lib/gameSyncFingerprint.ts` for authoritative setup fingerprinting.

Soccer-owned modules may continue importing the Soccer normalizer directly when they require a
concrete `SoccerSportGameState` result.

The fingerprint remains setup-only and excludes rebuildable projection and personal capture
preferences. Existing Soccer fingerprints must not change.

`isAggregateCloudSyncEligible` becomes true only when:

```text
eventStream === null && sportGameState === null
```

The current `sport.id !== 'soccer'` special case becomes unnecessary. Soccer event sync eligibility
stays Soccer-specific until the generalized cloud program in BKE-4.

## 4. Definition-Scoped Neutral Sides

Widen the generic envelope type and envelope validator to admit `neutral`. Do not make neutral valid
for every event merely because the transport can represent it.

`GameEventDefinition` gains an optional `allowedTeamSides` contract. Compatibility behavior is:

- omitted allowed sides mean `tracked` and `opponent` only;
- a future definition explicitly includes `neutral` when its sport payload supports it; and
- registry inspection rejects a disallowed side before calling the payload validator.

This keeps every existing Soccer definition unchanged and unable to accept neutral events while
letting BKE-1B register neutral administrative Basketball families deliberately.

Local serialization and fingerprints must preserve neutral values. No event that uses neutral may
enter cloud sync before BKE-4A widens the database check constraint and proves Soccer RPC parity.

## 5. Atomic Multi-Event Mutation

Add a discriminated operation type:

```ts
type GameEventMutation =
  | { type: 'update'; eventId: string; changes: Partial<GameEventEditableFields> }
  | { type: 'delete'; eventId: string }
  | { type: 'restore'; eventId: string }
```

The public helper accepts state, a non-empty operation array, one command timestamp, registry, and
projector registry. One timestamp makes every revision in the command auditable as one atomic action.

### Validation and commit contract

1. Require an initialized stream and at least one operation.
2. Reject duplicate target ids. One event may be revised at most once per command.
3. Resolve every target from the original raw stream.
4. Preserve protected envelope fields exactly as the single-event helpers do.
5. Preserve stored schema/payload on delete and restore; explicit update writes the current runtime
   schema.
6. Validate each proposed envelope and definition without mutating the input.
7. Install all proposed revisions into one candidate stream.
8. Rebuild and run sport semantic validation once against the final candidate state.
9. Commit only when the final inspection is complete.
10. On failure, return the original `GameState` object. No operation, revision, timestamp, or
    derived projection may leak from the failed candidate.

Final-state semantic validation is required. Valid linked edits may be temporarily inconsistent if
evaluated one operation at a time; the API exists to validate the coherent result.

Existing `updateGameEvent`, `deleteGameEvent`, and `restoreGameEvent` retain their public behavior in
BKE-1A. Shared private helpers may remove duplication, but existing Soccer call sites and accepted
single-event semantics do not change.

The new helper adds no reducer action yet. Basketball command wiring belongs to BKE-1C, once a
Basketball projector can validate linked final states.

## 6. Error Contract

Add narrow mutation errors where the caller can act on them:

- `empty_mutation_batch`;
- `duplicate_mutation_target`;
- existing `stream_not_initialized`, `event_not_found`, `already_deleted`, `not_deleted`,
  `invalid_event`, `sport_mismatch`, and `incomplete_projection` as applicable.

The first failing operation supplies deterministic failure precedence in caller order. Error text is
human-readable, but UI code branches only on the code.

## 7. Implementation Map

Expected files:

```text
src/lib/sportGameState/types.ts                 new
src/lib/sportGameState/state.ts                 new
src/lib/soccer/types.ts                         remove neutral alias ownership
src/lib/soccer/state.ts                         Soccer-specific normalizer
src/types.ts                                    neutral type import
src/context/GameContext.tsx                     neutral normalizer import
src/lib/gameParking.ts                          neutral normalizer import
src/lib/gameReducer.ts                          neutral normalizer import
src/lib/gameSyncFingerprint.ts                  neutral fingerprint + capability predicate
src/lib/gameEvents/types.ts                     neutral side + batch types/errors
src/lib/gameEvents/envelope.ts                  neutral envelope acceptance
src/lib/gameEvents/registry.ts                  definition-scoped side validation
src/lib/gameEvents/mutations.ts                 atomic multi-event helper
src/lib/gameEvents/gameEvents.test.ts           generic behavior coverage
docs/REGRESSION_TESTING.md                      manual regression entry
docs/AGENT_CODEBASE_OVERVIEW.md                 shared-state ownership note
AGENTS.md                                       shipped BKE-1A operational note
```

Exact filenames may follow existing conventions, but sport-neutral code must not live under the
Soccer directory after this phase.

## 8. Automated Acceptance

Focused tests must prove:

- missing, valid Soccer v1/v2, malformed, and unknown sport states normalize as before;
- parked/imported Soccer state and sync fingerprints remain stable;
- aggregate Basketball remains aggregate-cloud eligible;
- Soccer event games remain ineligible for aggregate sync and eligible for Soccer event sync;
- the generic envelope accepts neutral;
- a default existing definition rejects neutral;
- an opted-in fixture definition accepts neutral;
- a mixed update/delete/restore batch increments every target once and rebuilds once;
- delete/restore preserve a migrated raw schema while update writes current schema;
- empty batches, duplicate ids, missing ids, wrong tombstone state, invalid updates, and sport
  mismatch fail with the original state;
- final projection diagnostics reject the whole batch;
- valid final-state linked edits are not rejected because an intermediate operation would be
  inconsistent; and
- all existing event, Soccer, parking, fingerprint, reducer, and cloud tests pass.

Required commands:

```text
pnpm test
pnpm lint
pnpm build
```

## 9. Manual Regression

- Resume one parked Soccer match and confirm Tracker, Timeline correction, Summary, and local
  persistence behave normally.
- Start and track one legacy Basketball game; confirm court and stat-grid actions still use the
  aggregate path and cloud sync eligibility is unchanged.
- Export and re-import parked Soccer and Basketball games and confirm both remain resumable.
- Confirm production sport availability and routes are unchanged.

There is no new user-facing surface to visually approve in BKE-1A.

## 10. Delivery

Implement BKE-1A in one feature PR. The three changes share one proof boundary and are small enough
to review together, while BKE-1B remains isolated from generic refactoring.

After merge:

1. write the BKE-1B detailed plan against the final neutral state and mutation APIs;
2. run the focused Basketball setup/catalog/projector Q&A;
3. keep Basketball event creation unavailable; and
4. begin BKE-1B on a fresh feature branch.
