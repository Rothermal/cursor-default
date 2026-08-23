# Plan: BKE-5 Basketball Settings and Event Rollout

Status: Product and delivery Q&A approved. Implementation is split into BKE-5A through BKE-5D.
BKE-5A through BKE-5C remain internal; BKE-5D must not open the user-visible event-model opt-in
until the BKE-4 live release matrix and the targeted BKE-5 checks are accepted.

Parent roadmap: [PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md)

## 1. Goal

Deliver versioned Basketball rule profiles, built-in/personal/team/match settings resolution, a
complete immutable setup snapshot, explicit event-model creation choices, and a reversible rollout
policy without changing legacy Basketball authority or historical access.

## 2. Settled Boundaries

- Resolve versioned built-ins, personal defaults, team defaults, and explicit match overrides into
  one complete immutable rules snapshot before an event game starts.
- Keep display and capture preferences personal and non-authoritative. They never enter projection,
  sync fingerprints, or canonical publications.
- Require explicit per-game event-model selection and backend capability preflight. Never silently
  convert between event and legacy authority.
- Leave existing, parked, cloud, recovery, Summary, and canonical records reachable regardless of
  rollout or device preference.
- Preserve `seasons.team_stats_config` as legacy Basketball authority. BKE-5 may explicitly import
  it into event-game team defaults but never mutates or silently reinterprets it.
- Keep anchored clocks, lineup state, substitution enforcement, and derived on-court intervals in
  BKE-6. BKE-5 may snapshot the period and reset-window structure those features will consume.

## 3. Approved Q&A

### Batch A: Profile foundation

1. Ship separately versioned NFHS, NCAA Men's, NCAA Women's, NBA, FIBA, Youth Standard, Youth
   Equal-Play, and Custom starting profiles. Existing legacy season behavior remains unchanged.
2. Persist the selected profile and exact version. Never silently upgrade saved personal or team
   defaults; present newer built-in versions as an explicit update choice.
3. Do not automatically convert `seasons.team_stats_config`. Offer an explicit one-time import into
   Basketball team settings.
4. Do not add a separate custom-profile library in the first release. Editing a built-in stores
   validated overrides and presents the resolved result as customized.

#### Youth Equal-Play clarification

The approved Youth Equal-Play starting profile models eight distinct regulation periods with
halftime between Period 4 and Period 5. Every period boundary is a lineup-change opportunity, while
team-foul reset and timeout inventory use half-level windows: Periods 1-4 share the first-half
window and Periods 5-8 share the second-half window. Period identity, foul-reset windows, timeout
inventory windows, and future lineup windows must therefore be separate rule concepts.

BKE-5 snapshots this structure and uses it for period/foul/timeout behavior. BKE-6 later owns
mandatory lineup changes, equal-participation enforcement, substitutions, and on-court intervals.

### Batch B: Rules contract

5. Regulation periods reference separate foul-reset and timeout-inventory windows. Projection never
   assumes that each new period resets both. Window ids and ordering are stable within the immutable
   match snapshot.
6. Every built-in profile records its governing body or guideline family, effective season or rules
   version, source reference, and review date. The UI presents a concise profile/version label while
   retaining the full provenance in the profile catalog.
7. Profiles claim only behavior StatKeeper can enforce: regulation/overtime structure, foul and
   bonus policy, disqualification thresholds, and timeout inventory/carryover. BKE-5 may reserve the
   approved game-clock fields for BKE-6. Shot clock, court equipment, defensive restrictions, and
   other unimplemented competition rules are not represented as enforced settings.
8. Personal, team, and match customization uses validated controls and a resolved-rule preview.
   Users never edit stored JSON, and invalid partial or cross-field combinations cannot be saved or
   snapshotted.

### Batch C: Settings ownership

9. Personal settings store a preferred profile id/version, sparse rule overrides, and separate
   capture/display preferences. Anonymous values remain device-scoped; authenticated values are
   account-scoped.
10. Cloud team games use the team's profile id/version and sparse overrides independently of the
    recorder's personal rule defaults. Accepted owners/admins may edit; scorers/viewers receive
    read-only review.
11. An unconfigured cloud team resolves from the versioned application default rather than the
    current recorder's personal rules. Match Setup identifies that source and allows explicit match
    overrides. Managers may explicitly import legacy season rules into the team layer.
12. Basketball reuses the generic sport-settings tables with a versioned schema, compare-and-swap
    revisions, and settings-change audit events. Personal settings are cache-first with explicit
    cloud/device conflict recovery; team settings are account/team-scoped and online-only.

The effective hierarchy is deliberately authority-specific:

```text
Personal/local event game: built-in -> personal -> match
Cloud team event game:     built-in -> team -> match
```

This prevents two recorders from resolving different shared-team rules from unrelated personal
defaults while preserving useful personal defaults outside team authority.

### Batch D: Capture, display, and settings UI

13. Migrate the existing device rebound-prompt value into Basketball personal settings. An
    authenticated client seeds the cloud only when no Basketball cloud setting exists and never
    overwrites an existing cloud value. Anonymous use remains device-scoped.
14. Selected participant, Timeline filters, and temporary shot-value choices remain resumable
    per-game UI state rather than account settings or match rules.
15. The first persistent preference set contains only the established rebound-prompt preference and
    default court orientation. A game may retain a local orientation override. New assist or
    shot-value preferences require later user feedback rather than speculative controls.
16. `/settings/sports/basketball` uses compact Rules, Capture, and Display tabs. Team Manage exposes
    Basketball Rules with role-appropriate edit/read-only behavior. Match Setup presents a concise
    resolved-rules summary and a focused editor instead of one long settings page.

### Batch E: Match Setup and authority

17. A device-local `Enable Basketball event tracking` rollout preference defaults off. Enabling it
    reveals the per-game authority choice without affecting existing games or historical access.
18. New Game explicitly offers Event tracking and Legacy tracking. The initial rollout defaults to
    Legacy for every new game; choosing Event is deliberate. Changing that default requires later
    release evidence and user feedback.
19. Event setup shows the resolved profile, source, regulation/overtime structure, bonus policy,
    player foul limit, and timeout summary. Match-only overrides remain editable until game start.
20. Starting the event stream atomically freezes the complete rules snapshot. If a referenced
    personal/team revision changes while setup is open, the user must refresh from the new defaults
    or deliberately retain the reviewed draft. Legacy mode continues resolving
    `seasons.team_stats_config` through its existing path.

### Batch F: Capability and rollback

21. Team Info and direct team links enter a mutation-free setup draft. Authority selection and any
    required capability preflight complete before active-game confirmation, parking/replacement,
    `startNewGame`, or cloud authority assignment.
22. Capability failure offers only contextually supported Retry, Legacy cloud, Event local-only, or
    Cancel choices. Failure never mutates active or parked game identity and never silently changes
    the requested authority.
23. Event local-only games persist an explicit local-only cloud policy that suppresses automatic
    binding. A later user-invoked Enable Cloud Sync command must pass a fresh capability preflight
    before assigning cloud authority or binding.
24. Central Basketball event rollout policy supports `internal` and `opt_in`. Rolling back to
    `internal` hides only new event creation; existing event games, recovery, cloud sync, Summary,
    finalization/reopen, canonical review, and aggregate history remain reachable.

### Batch G: Profile fidelity and upgrades

25. Built-ins are labeled StatKeeper tracking profiles rather than complete competition rulebooks.
    Each profile declares the behavior currently enforced and identifies clock-dependent rules
    deferred to BKE-6. The product never implies complete officiating compliance.
26. Built-in profile versions are immutable and retained. Updating personal/team defaults requires
    a rule-diff preview. Compatible custom overrides are reapplied to the new base; incompatible
    combinations block the update until reviewed.
27. Legacy season import maps only provable `seasons.team_stats_config` fields into a reviewed Custom
    configuration. It never infers a governing profile from similar values, and missing modern fields
    require explicit confirmation before save.
28. Every built-in has source-linked fixtures covering regulation/overtime structure, foul windows,
    bonus behavior, disqualification, and timeout inventory. Coverage tests also prove that deferred
    clock-dependent rules do not alter a clockless game's projection.

### Batch H: Delivery and compatibility

29. Deliver four independently reviewable slices:
    - BKE-5A: source-audited profiles, expanded rules, resolver, validation, and compatibility.
    - BKE-5B: migration 062, personal/team persistence, settings UI, conflicts, audit, and explicit
      legacy import.
    - BKE-5C: setup authority choice, immutable snapshot, capability fallback, and persistent
      local-only binding policy.
    - BKE-5D: production rollout policy, regression/live evidence, and opt-in activation.
30. Existing event games retain their original rules snapshots and projection semantics. A
    version-aware normalizer reads the old and new contracts; no load, sync, edit, or republish path
    rewrites a version-1 game into the expanded contract.
31. Migration 062 adds fixed Basketball settings validation and compare-and-swap RPCs and advances
    the Basketball capability handshake to advertise the supported settings contract. Soccer's
    existing function signatures, validation, responses, audit behavior, and clients stay exact.
32. BKE-5A through BKE-5C merge under the internal creation gate. BKE-5D may expose `opt_in` only
    after the combined BKE-4 live matrix and BKE-5 profile/settings/setup checks are accepted.

## 4. Profile Catalog

### 4.1 Catalog contract

Built-ins are immutable code-owned records. A saved setting points to an exact `(profileId,
profileVersion)` pair; the complete resolved rules are copied into each event game's setup snapshot.

```ts
interface BasketballRulesProfile {
  profileId: string
  profileVersion: number
  label: string
  governingFamily: string
  effectiveRulesLabel: string
  sourceUrls: string[]
  reviewedAt: string
  coverage: {
    enforced: string[]
    deferred: string[]
  }
  rules: BasketballMatchRulesV2
}
```

The initial catalog contains `nfhs`, `ncaa_men`, `ncaa_women`, `nba`, `fiba`,
`youth_standard`, and `youth_equal_play`. `custom` is a presentation state produced by a built-in
plus overrides, not a mutable shared profile library. Profile ids never encode the effective year;
the version and provenance fields carry that information.

Every catalog value must be verified against a source fixture during BKE-5A. Starting references:

- [NFHS Basketball Rules](https://www.nfhs.org/sports/basketball/rules) and the
  [2023-24 foul/bonus change](https://www.nfhs.org/stories/free-throw-procedures-and-foul-administration-amended-in-2023-24-high-school-basketball-rules-changes).
  The current repository's one-and-one NFHS preset is stale and must not become the new default.
- [NCAA Men's Basketball Rules](https://www.ncaa.org/championships/playing-rules/mens-basketball-playing-rules/)
  and [NCAA Women's Basketball Rules](https://www.ncaa.org/championships/playing-rules/womens-basketball-playing-rules/)
  remain separate profiles.
- [NBA Official Rulebook](https://official.nba.com/rulebook/).
- [FIBA Official Basketball Rules](https://refereeing.fiba.basketball/en/rule-zone/official-basketball-rules-2024).
- [NBA/USA Basketball Youth Guidelines](https://ak-static.cms.nba.com/wp-content/uploads/sites/79/2018/03/9-11_Rules_and_Standards.pdf)
  for the standard youth baseline.
- Published eight-period equal-play examples such as
  [AYBL rules](https://ayblva.org/league-rules/) and
  [Nepean Blue Devils club policies](https://nepeanbluedevilsbasketballassociation.msa4.rampinteractive.com/content/club-policies)
  for the configurable Youth Equal-Play baseline.

These references support StatKeeper tracking behavior only. They do not make the application an
officiating rules engine. A source change creates a new retained profile version; it never mutates
the meaning of an older snapshot.

### 4.2 Version-2 rules shape

The current version-1 contract assumes that a period boundary is also a foul and timeout reset.
Version 2 separates those concepts:

```ts
interface BasketballMatchRulesV2 {
  rulesSchemaVersion: 2
  regulationSegments: BasketballSegmentRule[]
  overtimeTemplate: BasketballOvertimeRule
  foulWindows: BasketballFoulWindowRule[]
  timeoutPools: BasketballTimeoutPoolRule[]
  personalFoulLimit: number
  clockModel: 'none'
}

interface BasketballSegmentRule {
  id: string
  order: number
  label: string
  durationSeconds: number
  foulWindowId: string
  timeoutPoolId: string
  lineupChangeBoundary: boolean
}

interface BasketballFoulWindowRule {
  id: string
  label: string
  segmentIds: string[]
  bonusThreshold: number | null
  doubleBonusThreshold: number | null
  hasOneAndOne: boolean
}

interface BasketballTimeoutPoolRule {
  id: string
  label: string
  segmentIds: string[]
  fullLimit: number | null
  shortLimit: number | null
  carryoverToPoolId: string | null
}
```

The overtime template supplies its segment label sequence, duration, foul-window policy, timeout
pool policy, and carryover behavior. Validation rejects duplicate ids/order, missing references,
empty regulation, invalid thresholds, negative inventories, carryover cycles, and segments assigned
to contradictory windows. Neutral/media timeout events do not consume a charged pool.

Youth Equal-Play demonstrates why these are separate: it has eight segments and eight lineup-change
boundaries, but only two foul windows and two timeout pools, split at halftime after Period 4.
Lineup enforcement remains BKE-6. `durationSeconds` and the approved structural fields are retained
for BKE-6, but `clockModel: 'none'` keeps BKE-5 projection clockless.

### 4.3 Compatibility boundary

- Model rules as `BasketballMatchRulesV1 | BasketballMatchRulesV2` and normalize without enriching
  or rewriting persisted version-1 snapshots.
- Branch projection helpers only where reset/inventory semantics differ. Version-1 events must
  reproduce their current projection byte-for-byte for existing fixtures.
- Keep the event envelope/schema at version 1 unless BKE-5A's transport audit proves a payload
  compatibility requirement. A rules-contract change alone does not justify an event-schema bump.
- If the top-level Basketball sport-state version must advance, its normalizer must retain a true
  version-1 read path through local hydration, export/import, cloud pull, canonical review, edit,
  reopen, and republish.
- A complete rules snapshot remains projection authority. Catalog availability is never required to
  read or publish an already-started game.

## 5. Settings Contracts

### 5.1 Persisted payloads

Basketball uses schema version 1 in the generic sport-settings tables. This settings schema is
independent of the rules snapshot's `rulesSchemaVersion`.

```ts
interface BasketballPersonalSettingsV1 {
  baseProfile: { profileId: string; profileVersion: number }
  ruleOverrides: BasketballRuleOverridesV2
  capture: { reboundPromptAfterMiss: boolean }
  display: { defaultCourtFlipped: boolean }
}

interface BasketballTeamSettingsV1 {
  baseProfile: { profileId: string; profileVersion: number }
  ruleOverrides: BasketballRuleOverridesV2
}
```

The row's existing `schema_version` column carries settings schema version 1; it is not duplicated
inside the JSON payload. Fixed Basketball save RPCs supply that value. Parsers reject unknown keys,
unsupported profile versions, invalid override combinations, and unsupported row schema versions.
Arrays and window collections are atomic override fields; layers do not merge array elements by
index. A corrupt or unsupported layer is ignored as a whole with a visible diagnostic rather than
partially changing authority.

Resolution returns complete rules plus field/group source metadata:

```text
Personal/local: built-in -> personal -> match
Cloud team:     built-in -> team -> match
```

The code-owned application default is itself an exact profile version. An unconfigured team never
inherits the recorder's personal base or overrides.

### 5.2 Personal lifecycle

- Anonymous settings are stored in a device-only Basketball cache.
- Authenticated settings are keyed by user id and use cache-first reads, revision CAS writes,
  pending-offline state, focus/online refresh, and explicit Use Cloud / Keep This Device recovery.
- Cache keys and in-flight work are account-scoped; signing out or switching users cannot expose or
  save the previous account's Basketball settings.
- On first authenticated load with no Basketball cloud row, seed one row from the current local
  rebound-prompt value plus catalog defaults. Never overwrite an existing cloud row.
- Keep a compatibility read of `statkeeper_settings.courtCapture.reboundPromptAfterMiss` until the
  new Basketball row/cache is established. Do not delete or reinterpret legacy game settings.

### 5.3 Team lifecycle and legacy import

- Owners/admins may save Basketball team settings; scorers/viewers may read them.
- Team settings are online-only and keyed by account plus team. A stale revision requires reload;
  no last-writer-wins fallback is allowed.
- The one-time import reads the selected season's `team_stats_config`, maps only provable fields,
  and opens a reviewed Custom draft. It never writes back to the season or guesses NFHS/NCAA/etc.
- Values absent from the legacy shape, including independent foul/timeout windows, must be selected
  or confirmed before save. Re-running import remains possible and starts a new unsaved draft.

### 5.4 UI ownership

- `/settings/sports/basketball` uses `Rules`, `Capture`, and `Display` tabs to limit scrolling.
- `Rules` owns personal profile/version, validated overrides, provenance, resolved preview, upgrade
  diff, and reset. `Capture` owns rebound prompt. `Display` owns default court orientation.
- Team Manage adds a Basketball Rules section with edit controls for owners/admins and a compact
  read-only resolved view for scorers/viewers.
- Match Setup shows source badges and the complete resolved summary, then allows match-only
  overrides without mutating personal or team defaults.

## 6. Migration 062

Migration 048 created generic tables but its granted public save functions and validator are
Soccer-specific. Migration 062 reuses the tables without broadening those public functions:

1. Preserve the existing Soccer RPC names, argument lists, response rows, validation behavior,
   permissions, and `soccer_settings_changed` audit events exactly.
2. Extract or reuse a private revisioned-write core that performs row locking, expected-revision
   comparison, create/update, and deterministic response construction.
3. Add a strict private Basketball payload validator and fixed public wrappers such as
   `save_basketball_user_settings_revisioned(expected_revision, settings)` and
   `save_basketball_team_settings_revisioned(team_id, expected_revision, settings)`. Callers cannot
   choose another sport id or settings schema through these wrappers.
4. Enforce active app access and accepted team owner/admin authority consistently with Soccer.
   Direct table writes remain denied; current RLS-scoped reads remain the read surface.
5. Emit `basketball_settings_changed` through the existing immutable audit trail without storing
   sensitive payload contents.
6. Advance `get_basketball_release_capabilities()` to exact contract version 2 and advertise
   `settingsContractVersion: 1`. Old clients fail event-creation preflight as update-required while
   all historical access remains ungated.
7. Revoke private helpers from public/authenticated callers, grant only the fixed wrappers, and
   reload the PostgREST schema cache.

SQL regression must prove Soccer parity before and after migration 062, Basketball schema
rejection, RLS/role behavior, CAS conflict behavior, audit emission, and exact capability parsing.

## 7. Mutation-Free Match Setup

### 7.1 Staged draft

Basketball New Game, Team Info, and direct team links navigate to a reload-safe setup route before
creating or replacing any `GameContext` state. The draft loads sport/team/season/role, settings
revisions, selected profile, match overrides, authority choice, and cloud capability without
calling `startNewGame`.

The setup sequence is:

1. Resolve Personal/local or Cloud-team defaults and show their source/revisions.
2. Choose `Legacy tracking` or `Event tracking`; default to Legacy on every new draft.
3. For Event, review profile/rules and apply validated match-only overrides.
4. If cloud use is requested, complete capability preflight before any active-game confirmation.
5. Resolve failures through Retry, Legacy cloud, Event local-only, or Cancel, showing only choices
   supported by the current source/role.
6. Confirm parking/replacement only after a valid draft exists.
7. Commit once through a context-level setup command that installs the chosen authority and source
   metadata atomically.

Cancel, capability failure, stale settings, invalid rules, and route reload must leave the current
active game, parked manifest, cloud bindings, and dirty revisions unchanged.

### 7.2 Snapshot freeze

The Event draft remains editable through Player Setup. Immediately before event-stream
initialization, compare its source revisions with the latest personal/team revisions. When they
differ, offer Refresh Defaults or Keep Reviewed Draft. `prepareBasketballGameStart` then atomically
stores the complete immutable version-2 setup/rules snapshot, participants, and opening lifecycle
events.

Legacy setup stays on the existing aggregate reducer and `seasons.team_stats_config` path. No
shared setup helper may initialize an event stream for Legacy or copy aggregate settings into Event
without explicit import/review.

### 7.3 Persistent local-only policy

Event local-only is an explicit persisted sync policy, not the absence of a binding. It must survive
parking/resume, export/import, recovery, reload, and later sign-in, and the sync queue/binder must
honor it before any network mutation. It is sync metadata, not gameplay authority and not part of
event projection or canonical fingerprints.

An explicit `Enable Cloud Sync` command re-runs account/team capability and authorization checks,
revalidates duplicate bindings, and only then atomically clears local-only policy and binds. Failure
leaves the game local-only and preserves every local event.

## 8. Rollout Policy

Centralize creation policy as `internal | opt_in` in `sportAvailability.ts` (or its Basketball
equivalent). Keep these controls distinct:

- Basketball in `enabledSports` controls general sport navigation.
- `Enable Basketball event tracking` is a device-local, default-off rollout preference.
- `internal` restricts event creation to the existing development/internal gate.
- `opt_in` allows the device preference to reveal Event/Legacy choice in production.

Neither stage nor device preference gates existing local/parked/cloud event games, recovery import,
sync/conflict resolution, Summary, Game Info, finalization/reopen, canonical publications, or
aggregate destinations. Rolling back from `opt_in` to `internal` therefore stops only new event
creation. Legacy Basketball creation remains available throughout.

BKE-5D flips to `opt_in` only after the owner accepts the combined BKE-4 live matrix and BKE-5's
targeted profile/settings/setup evidence. Event remains a deliberate per-game choice defaulting to
Legacy after the flip.

## 9. Delivery Slices

### BKE-5A: Profiles and compatibility

- Add the source-audited immutable catalog and profile fixtures.
- Add version-2 segment/foul-window/timeout-pool rules, strict validation, sparse overrides,
  resolver/source metadata, and upgrade diffs.
- Teach projection/setup readers to consume version 1 and version 2 without rewriting history.
- Add Youth Equal-Play's eight segments, halftime foul/timeout windows, and lineup-boundary
  reservation; keep clock and lineup enforcement deferred.
- Exit: every catalog fixture resolves and projects; existing event fixtures remain unchanged.

### BKE-5B: Persistence and settings surfaces

- Add migration 062's fixed Basketball wrappers, validator, audit, and capability contract v2.
- Add account/device personal caches, CAS/conflict recovery, first-load rebound migration, team
  online-only settings, and strict source diagnostics.
- Build tabbed Basketball settings, Team Manage role-aware rules, resolved previews, profile
  upgrade diff, and reviewed legacy-season import.
- Exit: personal/team/match layers resolve deterministically and Soccer settings parity passes.

### BKE-5C: Setup authority and binding policy

- Replace early Basketball mutation with the staged setup draft and one atomic commit command.
- Add explicit Legacy/Event choice, stale-revision handling, capability fallback, and complete
  immutable snapshot freeze.
- Persist local-only sync policy and add guarded Enable Cloud Sync.
- Remove unconditional internal preflight paths that run before authority is chosen, while retaining
  the shared exact capability parser/cache.
- Exit: every cancel/failure path is mutation-free and Event/Legacy never dual-write.

### BKE-5D: Release and exit audit

- Add central `internal | opt_in` creation policy and the default-off device preference.
- Consolidate automated and manual evidence in `REGRESSION_BKE_5_SETTINGS_AND_ROLLOUT.md`.
- Run the live role/device/PWA/local/cloud matrix and record owner signoff.
- Flip production policy to `opt_in` only after acceptance; document rollback.
- Exit: production can create deliberate Event games without reducing historical or Legacy access.

## 10. Verification Matrix

### Automated

- Catalog/provenance fixtures for every profile and version, including current NFHS no-one-and-one
  behavior and separate NCAA Men's/Women's profiles.
- Version-2 validation for references, ordering, foul thresholds, timeout pools/carryover, and
  override compatibility.
- Youth Equal-Play: eight distinct periods, halftime after Period 4, eight lineup boundaries, two
  foul windows, and two timeout pools.
- Version-1 hydration/projection/sync/edit/reopen/republish parity and version-2 deterministic
  projection.
- Personal/local and Cloud-team hierarchy, source metadata, corrupt-layer fail-closed behavior,
  strict schema parsing, upgrade diffs, and legacy import mapping.
- Anonymous/authenticated cache isolation, no-overwrite seeding, offline pending state, focus/online
  reconciliation, personal CAS choices, and team stale-revision rejection.
- SQL role/RLS/CAS/audit tests plus exact Soccer RPC regression and Basketball capability v2 parsing.
- Mutation-free setup on cancel, stale settings, capability failure, active-game replacement decline,
  reload, and invalid rules.
- Event/Legacy authority isolation, local-only queue suppression, explicit later binding, parked and
  recovery persistence, and no automatic bind after sign-in.
- Rollout policy tests proving new-creation restriction and unconditional historical access.
- `pnpm test`, `pnpm lint`, `pnpm build`, migration/static contract checks, and focused diff audits.

### Live Supabase/browser

Exercise owner, admin, scorer, and viewer roles across Personal and Cloud-team setup; two accounts
and two browsers for CAS; offline personal edits; stale PWA capability v1 versus v2; local-only
parking/export/import/sign-in/later binding; existing event recovery; Legacy creation; Event cloud
sync/finalization/reopen; canonical Summary; and all aggregate destinations. Repeat the critical
creation and existing-access paths after forcing policy back to `internal`.

## 11. Explicit Deferrals

- Anchored game clock, stoppage reasons, substitutions, on-court intervals, lineup enforcement,
  equal-participation checks, and real minutes: BKE-6.
- Shot clock, court/equipment rules, defensive restrictions, officiating guidance, and complete
  competition-rule compliance.
- Shared custom-profile library, organization-wide defaults above team, and automatic profile
  upgrades.
- Changing production's per-game default from Legacy to Event.

## 12. Documentation and Exit

Each implementation PR updates this plan's slice status, the parent roadmap, `README.md`,
`AGENTS.md`, and `docs/AGENT_CODEBASE_OVERVIEW.md`. BKE-5D owns the consolidated regression record,
the accepted live evidence, exact migration order, production activation, and rollback instructions.

BKE-5 is complete only when BKE-5A through BKE-5D are merged, migration 062 is applied, the
combined BKE-4/BKE-5 release evidence is accepted, and production opt-in is both enabled and
reversible without hiding any existing game.
