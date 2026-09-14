# Basketball Workspace Modernization

Status: interaction direction approved; implementation plan proposed for review.
Documentation only. No tracker, clock or persistence behavior changes in this PR.

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
