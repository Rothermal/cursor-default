# Basketball Workspace Modernization

Status: initial workspace implementation complete; PR review and owner validation pending.

## Implemented workspace

- Court / Lineup / Actions navigation is available for legacy and event Basketball;
  event games retain Timeline. Actions is the compact entry for team/game controls.
- Team-name buttons select the capture side. Chart review has its own independent
  filter. Each court popup starts with explicit team attribution and can select an
  individual for that event without changing the global active player/preferences.
- Lineup cards open in-game stat controls; event participants also get their filtered
  editable Timeline. Legacy cards do not invent on-court or bench status.
- Manage Lineup uses the existing checked substitution sheet and still requires a
  paused clock. Clock/substitution policy redesign remains separate.
- Reuses existing court popup, stat buttons, Timeline/editors and substitution sheet.
  The new roster adapter is Basketball-owned because its participant and lineup
  semantics differ from Soccer; no speculative universal sport component was added.

### Action inventory

| Existing action | Destination |
| --- | --- |
| Located made/missed shots, assist/rebound follow-ups | Court popup, event-local actor |
| Chart filters, marker details/edit, chart undo/clear | Court, independent review filter |
| Individual direct shots/free throws, rebounds, assists, steals, blocks, turnovers | Lineup card -> player details |
| Personal fouls, manual minutes where supported, Steal + Turnover | Player details, existing checked commands |
| Team turnovers/fouls/technicals and legacy team grid | Actions, selected team |
| Charged/neutral timeouts and official player/staff ejections | Actions |
| Awarded free-throw trips | Actions and player details, same existing trip workflow |
| Score adjustments, lifecycle, clock and boundary review | Existing scoreboard/header/clock controls |
| Substitutions and late players | Manage Lineup and Add Player in Lineup |
| Event correction/history | Global Timeline and participant-filtered Timeline in details |
| Legacy decrement and newest-first undo | Player/team controls and existing Undo |
| Game notes | Actions |

### Validation

- Existing 1,816 tests passed; four new roster tests cover legacy status, opponent
  identity, immutable match membership and empty rosters.
- Production build passed. Isolated browser fixtures passed at 390px and 1280px in
  Light/Dark for legacy and event games: navigation does not mutate state, both sides
  capture correctly, popup actor cancellation does not persist, and no horizontal
  page overflow was detected.
- No schema, Supabase migration, saved-game conversion or clock-policy changes.
- PR review follow-up: legacy located shots require a tracked individual; team and
  opponent score changes remain scoreboard adjustments. Event games still support
  team/opponent shot attribution. Legacy opponent Add Player is disabled rather than
  introducing unsupported opponent scoring into the aggregate model.
- Added discriminating on-court/bench and paused/running/missing-clock control tests,
  legacy shot-actor guards, and whole-side chart tests including opponent individuals.
  Removed obsolete global-selection code; chart options use explicit team/player labels.
- Second review follow-up: late-event player rows and reconciliation now preserve
  participant sides, including repaired and recreated rows. The court derives sides
  from match participants for older local rows without mutating saved state. Parent
  component callback tests pin both the legacy popup restriction and submit guard,
  and verify that event-team capture still uses the checked event path.
- Owner checks after deployment: a clocked game using Manage Lineup, linked
  assist/rebound preferences, park/resume and a real cloud-bound game. Existing
  automated command/parking/cloud tests pass, but these live checks are not claimed.

## Approved outcome

Adopt [shared product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md): a slim court
workspace with team/opponent selection, event-local actor selection, lineup cards
opening in-game player details, and a separate Manage Lineup action. Reuse Soccer
patterns where they fit, while retaining Basketball's specific event controls.

## Code assessment

- `src/pages/GameTracker.tsx` combines legacy and event-authoritative Basketball.
  `PlayerSelectorStrip`, active-player targeting, court filtering and direct grid
  actions are coupled. Removing the strip alone can leave an invisible stale actor.
- `src/components/basketball/BasketballClockStrip.tsx` currently hosts lineup entry
  and commits via checked commands. `BasketballLineupSheet.tsx` is an existing
  workflow to preserve, not replace merely to match Soccer styling.
- `src/components/soccer/` provides the reference workspace/lineup/dialog patterns.
  Audit which semantics genuinely match before moving code to a shared directory.
- `src/lib/basketball/` owns capture, correction, eligibility and projection;
  `src/lib/basketball/productionClockPolicy.ts` distinguishes navigation from
  park/replace mutations. Keep those contracts intact.

## Proposed delivery

One coherent implementation PR is preferred if the command inventory and legacy
coverage remain reviewable. Do not prescribe artificial four-phase delivery.
Split only if routing/state extraction and behavior changes cannot be tested clearly.

1. Inventory every current grid/court/team action and assign its destination before
   removing controls. Include free throws, fouls, rebounds, assists, steals, blocks,
   turnovers, minutes, ejections, score adjustments, timeouts and corrections.
2. Introduce Court / Lineup / Timeline navigation and an in-game participant-detail
   view. Prefer a tracker-owned detail view with explicit Back to Lineup and preserved
   view state; choose a route only if existing navigation architecture warrants it.
3. Move individual stat controls into player details through adapters calling the
   same existing commands. Keep a compact team/game Actions entry for unlocated
   events, team attribution and administration. Do not make team actions depend on
   selecting a pseudo-player card.
4. Remove the live individual selector. Court capture initializes from the explicit
   side and prompts for valid attribution. A player-page action may prefill that
   player explicitly; returning to Court must not install an invisible global target.
5. Extract shared presentation pieces actually used by the new Basketball surfaces
   and existing Soccer callers when behavior is equivalent. Leave sport commands,
   field rendering and unique controls in sport modules.

## Boundaries and recommended defaults

- No event schema, cloud authority, clock/replay or saved-game conversion changes.
- Preserve legacy Basketball capture/review using its existing adapter; do not
  route legacy saves through event commands or fake lineup history. For games
  without tracked lineup history, show roster/player cards without invented on-court status.
- Detail identity uses stable match participants for event games, with a distinct
  legacy player mapping. Never treat an arbitrary current roster person as a match participant.
- Keep opponent/team totals accessible even when no opponent individuals exist.
- Read-only, terminal and quarantined games retain review/recovery navigation but
  do not gain mutation controls. Shared UI cannot grant permissions.
- Retain legitimate review filters and linked assist/rebound capture. Removing the
  capture strip is not permission to remove chart review functionality.

## Acceptance

- Every old action has a documented new destination; no orphaned team/stat controls.
- Both sides can capture a shot with explicit actor/team attribution and correct
  assist/rebound relationships; no stale active player can block or hijack capture.
- Lineup card opens details; Manage Lineup opens existing substitution workflow.
- Navigation does not mutate game fingerprints, start/stop clocks or commit lineups.
- Player details show the correct match stat line and event history; commands retain
  period, eligibility, stale-state, correction and terminal guards.
- Legacy and event Basketball fixtures both pass capture, undo/correction, reload,
  park/resume and read-only review checks. No aggregate/event dual writing.
- Desktop/mobile Light/Dark checks include long names, empty/opponent rosters,
  overflow, touch targets, dialog focus/back behavior and dense stat sections.

## Questions to resolve during implementation assessment

Recommended defaults above allow progress, but confirm any discovered conflicts:
does the existing route structure require deep links; which legacy controls have
no safe equivalent; and which Soccer components can be reused without expanding
scope? Bring material behavior tradeoffs back to the owner rather than silently
deleting functionality. Running-clock substitutions remain a separate plan.
