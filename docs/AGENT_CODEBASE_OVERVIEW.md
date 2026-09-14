# Agent Codebase Overview

Read this overview first, then [the documentation index](README.md) and the plan
owning the task. [AGENTS.md](../AGENTS.md) contains operational gotchas; historical
feature summaries there may describe legacy paths. Inspect current code before
assuming a plan or old note is the implemented behavior.

## Current Architecture

StatKeeper is a React/TypeScript PWA. Soccer has a released event-based experience.
Basketball supports both historical aggregate games and an opt-in event tracker.
Other configured sports are not completed sport-specific products.

| Area | Starting points |
| --- | --- |
| Routing and sport dispatch | [App.tsx](../src/App.tsx), [sportAvailability.ts](../src/lib/sportAvailability.ts) |
| Local game state and transitions | [GameContext.tsx](../src/context/GameContext.tsx), [gameReducer.ts](../src/lib/gameReducer.ts) |
| Shared event engine | [gameEvents](../src/lib/gameEvents/), [sportGameState](../src/lib/sportGameState/) |
| Soccer rules, commands and projection | [soccer](../src/lib/soccer/) |
| Basketball rules, commands and projection | [basketball](../src/lib/basketball/) |
| Basketball/legacy tracker | [GameTracker.tsx](../src/pages/GameTracker.tsx) |
| Soccer tracker | [SoccerGameTracker.tsx](../src/pages/SoccerGameTracker.tsx) |
| Event summaries | [BasketballSummary.tsx](../src/pages/BasketballSummary.tsx), [SoccerSummary.tsx](../src/pages/SoccerSummary.tsx) |
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

Basketball is the next adopter. Soccer provides examples, not a perfect template to
copy wholesale. [The Basketball plan](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md)
separates workspace changes from the unimplemented clock/replay redesign.

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
