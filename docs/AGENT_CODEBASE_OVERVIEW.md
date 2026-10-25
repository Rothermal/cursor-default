# Agent Codebase Overview

Read this overview first, then [the documentation index](README.md) and the plan
owning the task. [AGENTS.md](../AGENTS.md) contains operational gotchas; historical
feature summaries there may describe legacy paths. Inspect current code before
assuming a plan or old note is the implemented behavior.

## Current Architecture

StatKeeper is a React/TypeScript PWA. Soccer has a released event-based experience.
Basketball's event-only creation and read-only aggregate retirement merged in #506;
its compact full-court event tracker merged in #491. See the
[cutover record](REGRESSION_TUI_1_BASKETBALL_CUTOVER.md).
Hockey has a released event tracker, Summary and cloud lifecycle; every new Hockey
game uses events. Its read-only legacy retirement is implemented for review in the
[TUI-2 cutover](REGRESSION_TUI_2_HOCKEY_CUTOVER.md). Baseball's BSB-7D event-only creation and legacy retirement are
merged in #505; existing event games and authorized legacy-data sync remain
available independently of the creation rollback switch. See its
[cutover record](REGRESSION_BSB_7D_EVENT_ONLY_RELEASE.md). Baseball has a tracker, Summary and cloud sync;
recorder management/finalization/reopen merged in #495 and BSB-6C cloud Summary
merged in #496. [BSB-7](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md) is approved;
its 7A server foundation is implemented in migration 079 (owner reports application
on 2026-10-20). The client half adds pure replay aggregates, strict account/epoch
paging and checked personal identity/intents, without UI wiring; see the
[client evidence](REGRESSION_BSB_7A_CLIENT.md). BSB-7B now implements the five
destinations, separate Legacy Totals, personal Game Info link review/reviewed
finalization and explicit team-tournament persistence for review; see its
[regression record](REGRESSION_BSB_7B_DESTINATIONS.md). Full 7A exit is not claimed. Baseball
has no new-game authority toggle after 7D; BSB-6/live release checks remain pending.
BSB-7C1's personal-settings foundation merged in #503, with fixed
migration-080 account-bound CAS/read/capability RPCs and an isolated offline
controller; see [7C evidence](REGRESSION_BSB_7C_PERSONAL_SETTINGS.md). It is now
mounted by 7C2's Baseball-only auth-lifetime hook (merged #504). Settings now shares
bounded rule fields with Team Manage; fresh setup seeds personal/team defaults,
offers explicit My Players/Create Player choices and commits separate durable link
intents with the complete local game. Device capture defaults seed new games only.
Owner reports migration 080 applied on 2026-10-23; live behavior remains separately
pending. Legacy Baseball games are read-only, including unfinished/offline games;
they never convert or auto-finalize. Corrupt event authority cannot fall back to legacy.
Football still uses the generic aggregate grid; its event plans
are not an implemented field experience. Pending live verification remains separate.

| Area | Starting points |
| --- | --- |
| Routing and sport dispatch | [App.tsx](../src/App.tsx), [sportAvailability.ts](../src/lib/sportAvailability.ts) |
| Local game state and transitions | [GameContext.tsx](../src/context/GameContext.tsx), [gameReducer.ts](../src/lib/gameReducer.ts) |
| Shared event engine | [gameEvents](../src/lib/gameEvents/), [sportGameState](../src/lib/sportGameState/) |
| Soccer rules, commands and projection | [soccer](../src/lib/soccer/) |
| Basketball rules, commands and projection | [basketball](../src/lib/basketball/) |
| Basketball/legacy tracker | [GameTracker.tsx](../src/pages/GameTracker.tsx) |
| Soccer tracker | [SoccerGameTracker.tsx](../src/pages/SoccerGameTracker.tsx) |
| Hockey and Baseball trackers | [HockeyGameTracker.tsx](../src/pages/HockeyGameTracker.tsx), [BaseballGameTracker.tsx](../src/pages/BaseballGameTracker.tsx) |
| Event summaries | [BasketballSummary.tsx](../src/pages/BasketballSummary.tsx), [SoccerSummary.tsx](../src/pages/SoccerSummary.tsx), [HockeySummary.tsx](../src/pages/HockeySummary.tsx), [BaseballSummary.tsx](../src/pages/BaseballSummary.tsx) |
| Legacy summary | [GameSummary.tsx](../src/pages/GameSummary.tsx) |
| Cloud dispatch and safeguards | [cloudSync.ts](../src/lib/cloudSync.ts), [gameSyncFingerprint.ts](../src/lib/gameSyncFingerprint.ts) |
| Settings and appearance | [SettingsContext.tsx](../src/context/SettingsContext.tsx), [appearance.css](../public/appearance.css) |
| Access policy | [teamPermissions.ts](../src/lib/teamPermissions.ts), [ACCESS_MATRIX.md](ACCESS_MATRIX.md) |
| Database history | [migrations](../supabase/migrations/), [operator scripts](../supabase/scripts/) |

## Authority Boundaries

- One local game is mounted at a time; multiple games can be parked across sports.
  The manifest identifies the active local game and per-game storage records.
- Event-authoritative games replay validated, revisioned event streams. UI must use
  checked sport commands; never patch projected totals as a second authority.
- Legacy aggregate Basketball remains distinct. Do not initialize event streams,
  rewrite old games, or route event games through legacy stats/shot-table sync.
- Cloud recorder streams stay independent. Canonical publication determines
  official event-game results; remote review must not hydrate the active local game.
- Preserve dirty-state, stale-result, quarantine, recovery and duplicate-binding
  protections. A successful request is not automatically a successful complete sync.
- Match setup and participant snapshots preserve historical identity. Current team
  defaults must not overwrite existing match history.
- Presentation preferences and navigation state must not enter gameplay fingerprints.
- Browser route/tab navigation must not invent a clock or lineup event. Parking,
  completion, corrections and substitutions retain their explicit command policies.

## Shared UI Direction

[Product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md) define the approved target.
Share stable presentation primitives and interaction contracts. Sport modules own
eligibility, event payloads, validation and projection. Use focused slots/capabilities,
not a universal component containing branches for every sport.

Basketball's workspace, attribution and full court are implemented. The
[shared tracker plan](PLAN_TRACKER_UI_UNIFICATION.md) owns layout and legacy
retirement. The compact layout merged in #491; event-only creation and legacy
retirement merged in #506. Soccer/Hockey layout alignment merged in #507
([TUI-2](REGRESSION_TUI_2_SOCCER_HOCKEY_LAYOUT.md)); Hockey legacy retirement is
implemented for review in the [cutover](REGRESSION_TUI_2_HOCKEY_CUTOVER.md).
The target is one event UI per sport, with legacy games reduced
to read-only stat summaries. This is not permission to discard local data. Soccer
provides examples, not a
perfect template. Football needs its event foundations before adoption. The
[earlier Basketball plan](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md) remains history.

## Timing Is Not Yet Redesigned

[Event timing and live lineups](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) is an
architectural assessment. Running-clock lineup submission and decoupled display
time are goals, not permission to remove projector guards. Preserve recorder
sequence, event facts, eligibility and deterministic replay.

## Documentation Workflow

1. Establish current code, release policy and branch status.
2. Read the active plan and linked regression record, including unresolved items.
3. Label changes as implemented, approved target, proposed, deferred or verified.
4. Update the owning plan and current entry points when their claims change.
5. Archive only after extracting outstanding work into a discoverable active record.
   Preserve old design rationale and update links or leave explicit redirects.

[Archive audit](DOCUMENTATION_ARCHIVE_AUDIT.md) records this reset's decisions.
The [prior overview](archived/AGENT_CODEBASE_OVERVIEW_PRE_RESET.md) is historical,
not an alternative current architecture reference.

## Verification and Runtime

Use package scripts: typecheck, lint, test and build. Scale tests to risk; UI work
also needs desktop/mobile visual and interaction checks. Database and real-device
checks must be reported separately from local unit tests.

HashRouter paths include `/#/`. Vite normally uses port 5173 but may select another.
Keep credentials out of tracked files, do not discard unrelated work, and preserve
existing local games when testing. See [AGENTS.md](../AGENTS.md) for operational detail.
