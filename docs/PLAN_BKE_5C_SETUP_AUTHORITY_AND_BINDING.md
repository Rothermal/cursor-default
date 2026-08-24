# Plan: BKE-5C Basketball Setup Authority and Binding Policy

Status: Delivery design approved from the parent BKE-5 Q&A. No new product decisions are required.
Implementation is split into BKE-5C1 through BKE-5C4 and remains behind the internal Basketball
event-creation gate.

Parent: [PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md](PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md)

## 1. Goal

Make Basketball setup a reload-safe draft that does not park, replace, bind, or mutate the active
game until the user has selected a valid authority and accepted the final replacement confirmation.
Freeze exact reviewed rules before event capture, make local-only cloud intent durable, and provide
one guarded path for enabling cloud sync later.

## 2. Inherited Product Decisions

- Every new draft defaults to Legacy tracking. Event tracking is always deliberate.
- Personal/local Event rules resolve `built-in -> personal -> match`.
- Existing cloud-team Event rules resolve `built-in -> team -> match`; personal rule defaults never
  enter that branch.
- Legacy remains authoritative through `seasons.team_stats_config` and the aggregate reducer.
- Event setup freezes one complete version-2 rules snapshot before the stream starts.
- Cloud capability failure offers only contextually valid Retry, Legacy cloud, Event local-only, or
  Cancel actions. It never silently changes authority.
- Local-only is persisted policy, not a missing binding or a temporary offline state.
- Existing and historical games remain reachable regardless of creation policy or device settings.
- BKE-5C remains internal. BKE-5D owns the production opt-in and release evidence.

No database migration is currently planned. BKE-5C uses migration 062's capability contract and the
existing Basketball v4 binder/transport. If C4 finds that a required ownership or binding guarantee
cannot be proven through the fixed existing surfaces, stop and design a narrow reviewed migration;
do not broaden a generic RPC or infer authorization in the client.

## 3. Current-State Audit

The current `GameSetup` flow mutates too early in five places:

1. `SportDashboard.handleStartNew` confirms and calls `startNewGame` before `/setup` renders.
2. `TeamInfo.handleStartGame` preflights Event support before authority is chosen, then parks,
   creates an active game, and writes cloud team metadata before setup.
3. The direct `teamId` loader in `GameSetup` may preflight, confirm, and replace the active game
   while merely resolving the route.
4. A setup effect dispatches `SET_TEAM_STATS_CONFIG` whenever the selected season changes.
5. The internal Event toggle hydrates `GameContext` immediately, and `handleNext` may switch teams,
   create/update tournaments, write cloud metadata, and write game info in separate steps.

These paths can leave partial setup state, bind intent before authority exists, and make Cancel or a
later validation failure observable in the active/parked game. Existing source-order tests prove
capability calls happen before some mutations, but do not make the route itself mutation-free.

Non-Basketball setup behavior is outside this change. Soccer's released setup and capability
contracts must remain exact.

## 4. Draft Contract

### 4.1 Versioned draft

Add a strict, clone-safe `BasketballSetupDraftV1` outside `GameContext`:

```ts
interface BasketballSetupDraftV1 {
  version: 1
  draftId: string
  accountScope: string
  createdAt: string
  updatedAt: string
  source:
    | { kind: 'personal'; teamName: string }
    | {
        kind: 'team'
        teamId: string
        seasonId: string
        teamName: string
        seasonName: string
        accessRole: 'owner' | 'admin' | 'scorer'
      }
  authority: 'legacy' | 'sport_events'
  gameInfo: {
    opponentName: string
    tournamentMode: 'none' | 'existing' | 'new' | 'text'
    tournamentId: string | null
    tournamentName: string
    tournamentUrl: string | null
    date: string
  }
  display: {
    defaultCourtFlipped: boolean
  }
  event: null | {
    settingsAuthority:
      | {
          kind: 'personal'
          revision: number | null
          settings: BasketballPersonalSettingsV1
        }
      | {
          kind: 'team'
          revision: number | null
          settings: BasketballTeamSettingsV1
        }
    matchOverrides: BasketballRuleOverridesV2
    reviewedRules: BasketballMatchRulesV2
    reviewedRulesSource: BasketballRulesSource
    cloudIntent: 'automatic' | 'local_only'
  }
  committedLocalGameId: string | null
}
```

The concrete TypeScript may separate route identity, loaded source data, and persisted user choices,
but it must preserve these authority facts. `display.defaultCourtFlipped` always comes from the
current personal/device settings, including for a team-sourced game; team rule authority does not
own personal presentation. Capability responses, transient errors, loading state, raw Supabase
rows, and roster payloads are not persisted in the draft.

### 4.2 Storage and account isolation

- Store the draft under an exact versioned Basketball key separate from active/parked game records.
- Key authenticated drafts by user id and anonymous drafts by the existing anonymous scope.
- Reject unknown keys, unsupported versions, invalid ids/dates/roles, impossible authority/source
  combinations, and malformed rule snapshots.
- A sign-out/account switch cannot read or commit the prior account's draft.
- Reload restores only the matching route/source draft. A new explicit start replaces the prior
  uncommitted Basketball draft after confirmation when meaningful edits exist.
- Cancel clears only the setup draft and returns to its source route. It does not dispatch or write
  game storage.

### 4.3 Source identity versus cloud binding

A team-sourced local-only Event draft retains `teamId` and `seasonId` as reviewed source identity.
After stream initialization those values live in immutable `BasketballMatchSetup.sourceTeamId` and
`sourceSeasonId`. They do not enter `cloudSync.teamId/seasonId` while policy is local-only.

This distinction is mandatory: source identity answers which roster/defaults were reviewed; cloud
binding metadata authorizes the queue to create or update cloud rows. The two must never be inferred
from each other.

## 5. Entry and Commit Flow

### 5.1 Mutation-free entry

- Basketball Sport Dashboard navigates to `/#/setup?sport=basketball` without `startNewGame` or an
  active-game prompt.
- Basketball Team Info navigates to `/#/setup?teamId=...` without capability preflight, parking,
  cloud metadata writes, or `startNewGame`.
- A direct team link performs read-only sport/role/team/season lookup and initializes a team draft.
- Game Setup derives Basketball presentation from the draft and loaded source, not `state.sport`.
- Existing committed pre-start Basketball setup may return from Player Setup and reopen its matching
  draft. Unrelated active games remain untouched until a new draft commits.
- Existing non-Basketball entry flows continue using their current context path.

### 5.2 Validation order

Before any mutation, Continue performs:

1. strict draft/source/role validation
2. Event rule resolution and source-revision validation when Event is selected
3. cloud capability preflight only when Event automatic cloud is requested
4. local storage/capacity preflight
5. contextually valid capability recovery, if needed
6. final Park Current Game and Continue confirmation when another game is active
7. deferred tournament resolution
8. one context-level setup commit

Legacy cloud does not call the Basketball Event capability RPC. Event local-only does not call a
cloud binder. Capability failure and Cancel occur before steps 6-8.

### 5.3 Tournament side effects

Existing tournament selection is read-only. A new tournament or URL update stays in the draft until
after validation, capability, capacity, and replacement confirmation succeed. Resolve it immediately
before the local context commit. Look up before insert instead of using a blind upsert: retain proof
when this attempt inserts a row, and refetch rather than claiming creation on a uniqueness race.
Capture the prior URL before any update. If local commit then fails, best-effort delete only a row
proven newly inserted by this attempt or restore the exact prior URL. Surface compensation failure
without hiding the preserved active game.

### 5.4 Atomic local commit

Add one narrow `GameContext` command for a complete validated setup candidate. It must:

- snapshot the current manifest, active id, and active state
- persist the current active game when meaningful
- create the next local game id and complete candidate state
- update the manifest/active id and React state as one logical transaction
- restore the previous manifest/state when any local storage step fails
- expose one error without leaving a half-created parked record

The candidate installs sport, game info, selected Legacy/Event authority, legacy season config or
reviewed Event source metadata, and permitted cloud binding metadata together. It does not initialize
the Event stream; Player Setup still owns roster review and the final start command.

## 6. Event Rule Freeze and Stale Revisions

- Event setup shows the complete resolved profile/rules summary with source labels and match-only
  override controls. Edits never save personal/team defaults.
- The draft stores the exact personal/team revision and payload used for review.
- Immediately before `prepareBasketballGameStart`, fetch/reconcile the latest authoritative settings
  revision without mutating the game.
- If the revision changed, block start and offer:
  - **Refresh Defaults:** replace the source layer, reapply compatible match overrides, show a diff,
    and require review.
  - **Keep Reviewed Draft:** retain the already reviewed complete rules and old source revision.
- Incompatible overrides block Refresh until edited. Legacy never enters this flow.
- `prepareBasketballGameStart` receives the reviewed version-2 rules/source explicitly and atomically
  initializes immutable setup, participants, Period 1, and the event stream.
- No catalog lookup or current settings row is needed to read the started game afterward.

The frozen `BasketballMatchSetup.rulesSource` is part of this contract, not an implementation
default. Populate it as follows:

- `profileId` and `profileVersion` come from the reviewed authoritative settings base profile.
- Personal authority freezes `personalRevision` and sets `teamRevision` to `null`; team authority
  freezes `teamRevision` and sets `personalRevision` to `null`.
- `hasExplicitMatchOverrides` is the existing compatibility field used to decide whether a named
  built-in profile may be claimed. Despite its narrow historical name, set it to `true` when any
  personal, team, or match override layer contributed to the resolved rules, and `false` only for
  an unmodified built-in profile.
- **Keep Reviewed Draft** freezes the reviewed source record and old revision together with its
  reviewed rules. **Refresh Defaults** rebuilds both records from the refreshed layer and reapplied
  match overrides.

Do not retain `DEFAULT_BASKETBALL_RULES_SOURCE` in the new C2 start path. A customized personal or
team layer must display as Custom after start; only an unmodified reviewed catalog profile may
display its profile name/version. Tests must assert the entire source record as well as the rules
snapshot.

### 6.1 Display default handoff

`defaultCourtFlipped` is personal presentation, independent of Legacy/Event and personal/team rules
authority. At the one-time local setup commit, seed the new game's court orientation from the
reviewed personal/device display setting for both authorities. Event games store the resulting
`standard | flipped` value in `capturePreferences.courtOrientation`; Legacy uses the equivalent
per-game presentation state. A later manual flip changes only that game's local orientation.

The orientation is reload-safe but remains outside immutable match rules, event projection,
canonical output, gameplay fingerprints, and cloud authority. Existing games keep their current
orientation and are never rewritten from a later settings change.

## 7. Durable Local-Only Policy

### 7.1 State contract

Add explicit event-cloud policy to sync metadata, with exact normalization for old records. New
Event games always persist `automatic` or `local_only`; Legacy games do not consume the field.
Pre-BKE-5C Event records without the field retain their established automatic behavior for
compatibility and are never rewritten merely by hydration.

The policy:

- survives active persistence, parking/resume, export/import, recovery, reload, and sign-in
- stays outside gameplay projection and canonical/gameplay fingerprints
- is included in sync-queue eligibility fingerprinting where needed to wake/stop queue work
- is checked before bind, pull, merge, upload, checkpoint, and automatic cloud adoption
- cannot be cleared by ordinary `SET_CLOUD_SYNC_STATE` patches or successful unrelated sync work

Local-only means no cloud mutation. Existing remote review/history remains unaffected.

### 7.2 Capability fallback

When automatic Event cloud preflight fails, show the returned reason and only supported actions:

- Retry Check
- Continue as Legacy Cloud when Legacy is valid for the selected source
- Continue Event Local-Only when the roster/rules can be snapshotted locally
- Cancel

Changing to Legacy or local-only is explicit and updates the draft only. The user then reviews and
continues through the same final confirmation/commit path.

## 8. Enable Cloud Sync

Expose Enable Cloud Sync only for a healthy owned local-only Basketball Event game. The command:

1. verifies sign-in, app access, recorder ownership, source team role when applicable, and release
   capabilities with a fresh check
2. verifies no other local game owns the proposed cloud binding
3. uses the existing v4 Basketball binder/idempotency contract
4. uploads/checkpoints the complete local stream
5. clears local-only policy and installs binding metadata only after confirmed success

Any failure leaves policy, local events, parked identity, and active state unchanged. A successful
command becomes ordinary automatic Event sync. Disabling cloud again is deferred; users can export
or keep tracking offline, but a bound cloud game does not silently become a divergent local fork.

## 9. Delivery Slices

### BKE-5C1: Draft and atomic setup commit

- strict versioned/account-scoped draft storage
- mutation-free Basketball entry from Sport Dashboard, Team Info, and direct team links
- draft-driven Game Setup with Legacy default
- the existing internal Event preview writes only the draft; C2 replaces it with the complete
  segmented authority/rules review
- deferred season/tournament/game-info state
- rollback-safe context commit and route-reload/cancel tests
- no changes to Soccer or other sport setup flows

Exit: opening, editing, reloading, or cancelling Basketball setup cannot alter active/parked state;
one validated Continue creates exactly one new local game.

### BKE-5C2: Rules authority and snapshot freeze

- personal/team settings source loading and exact source badges
- Event/Legacy segmented choice and resolved match-only editor
- reviewed rule persistence through Player Setup
- stale revision Refresh/Keep flow
- complete `rulesSource` provenance plus explicit version-2 rules passed to event-stream
  initialization
- personal display-default consumption into reload-safe per-game court orientation for Legacy and
  Event setup

Exit: Event and Legacy use distinct authorities, team games cannot inherit personal rules, and a
started Event stream contains the exact reviewed immutable rules and source snapshot. New games
start with the reviewed personal court orientation without turning display state into rules
authority.

### BKE-5C3: Capability fallback and local-only policy

- authority-aware preflight after choice and before confirmation
- Retry/Legacy/Event local-only/Cancel recovery matrix
- explicit normalized event-cloud policy across parking/export/import/recovery
- queue/binder/pull/upload/checkpoint guards
- removal of premature Basketball preflights from Team Info and route loading

Exit: every preflight failure is mutation-free and a local-only game produces no cloud request.

### BKE-5C4: Enable Cloud Sync and exit hardening

- guarded fresh-preflight Enable Cloud Sync command and UI
- duplicate-binding and recorder/source-role checks
- bind/upload/checkpoint success transaction with failure preservation
- cross-sport, active/parked, PWA/reload, and no-dual-write regression audit
- BKE-5C documentation and BKE-5D handoff

Exit: local-only can become automatic only after confirmed cloud success; all failures preserve the
complete local game, and Legacy/Event never dual-write.

## 10. Verification

Automated coverage must include:

- exact draft parsing, account isolation, reload, replacement, and corrupt-draft rejection
- no GameContext/storage writes from Basketball entry, edit, capability failure, stale rules, or
  Cancel
- rollback on each local commit storage failure and best-effort tournament compensation
- Legacy default and no Event capability RPC for Legacy/local-only
- personal versus team hierarchy isolation and source revision metadata
- compatible/incompatible stale-revision choices and exact frozen rules plus complete `rulesSource`
- customized personal/team/match rules display as Custom while an untouched built-in retains its
  exact profile/version label
- personal court-orientation default for Legacy, personal Event, and team Event starts; per-game
  flips survive reload and later settings changes do not rewrite existing games
- local-only preservation through every local transport and zero binder/upload calls
- pre-BKE-5C Event compatibility without hydration rewrites
- guarded Enable Cloud Sync failure/success and duplicate binding rejection
- unchanged Soccer route/preflight/settings tests and unchanged legacy Basketball aggregate sync

Manual evidence is recorded per slice. BKE-5D later incorporates the accepted BKE-5C checks into
the combined production opt-in matrix.

## 11. Deferred

- production `internal -> opt_in` activation and default-off device preference: BKE-5D
- game clock, stoppages, substitutions, on-court intervals, and equal-play enforcement: BKE-6
- disabling cloud after a successful binding or creating deliberate local forks
- organization-level defaults and shared custom-profile libraries
