# Shared Product and Interaction Decisions

Status: approved product direction. Adoption is incremental; this document does
not claim that every sport already implements the target. Basketball UI is next.

## Surface-first tracking

- The court, pitch or playing field is the primary live capture workspace.
- Keep team/opponent selection, labelled with team display names/nicknames.
- Remove the global individual-player capture strip as each sport adopts this model.
  Choose attribution inside the event dialog; do not silently attribute from a
  hidden global selection. Team/unknown attribution is available only where valid.
- New live event actor dropdowns default to Unattributed for the selected side,
  never the previous event's player. If the event requires an individual, saving
  remains blocked until a valid player is selected. Sport and legacy restrictions
  still apply; the default does not grant unsupported unattributed capture.
- An action explicitly launched from a player's in-game detail page may prefill that
  player, subject to eligibility. Merely visiting details must not install a global
  capture target; subsequent general surface capture still starts Unattributed.
- Keep compact non-location event and game-operation controls. Never require a
  fabricated field position to record a timeout, substitution or other unlocated fact.
- Distinguish read-only chart filtering from recording attribution. Historical
  player filters may remain in review without becoming a hidden capture target.

## Players and lineups

- App-wide roster rule: store one default position and Starter/Bench status per
  player on the team roster. Each sport supplies its own positions and lineup rules.
- New games snapshot these defaults with per-game overrides. In-game position or
  lineup changes do not update team defaults; later default edits do not rewrite
  existing games. A player's defaults are scoped to their team, not global identity.
- Missing roster defaults mean Unassigned position and Bench; select starters
  explicitly rather than inferring from jersey number or roster order. Preserve
  existing saved defaults and historical game lineups.
- Multiple players may share a position; do not require one player at each position.
  Alternate-position lists are not part of the initial design. Position and starting
  status are separate concepts; sport eligibility and lineup-size rules still apply.
- Actor dropdowns use each sport's position order, then jersey number within each
  position, with unassigned positions after known positions and Unattributed last.
  Ordering does not override event eligibility.
- General live-event actor pickers show only eligible on-court/on-field participants
  when lineup tracking is available, excluding bench players. Other participants
  remain accessible through details/corrections subject to sport command rules.
  Without lineup tracking, show the eligible roster without inventing lineup status.
- Where a sport permits bench/staff offenses, expose an explicit alternate offender
  path in the appropriate event form rather than expanding ordinary live actor
  dropdowns. Staff need not be stat-tracked roster players; sport commands remain
  authoritative for supported offender/event combinations.
- Allow custom positions alongside each sport's standard catalog. Sort custom
  positions after standard positions and before Unassigned; preserve saved custom
  values rather than coercing them to a standard position.
- These are approved defaults for adoption, not a claim of implemented roster storage
  across all sports. See the [Basketball follow-up Q&A](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md).

- Tapping a lineup card opens that participant's details for this game, not their
  permanent profile and not a substitution action.
- A separate Manage Lineup control opens substitution/lineup management.
- Player details provide stat lines, game event history and relevant player-specific
  actions/corrections. Basketball's direct stat controls move here as appropriate.
- Player navigation and draft selection do not change the lineup or stop the clock.
  Actual commit behavior remains governed by the implemented sport command policy.
- Team/opponent actions need an explicit home too; do not strand them when removing
  the player strip. Opponent detail depends on recorded participants, not invented rosters.

## Reusable components with sport extensions

Share stable presentation and workflows: workspace navigation, side selection,
lineup card framing, player-detail framing, attribution pickers, dialog save/error
states and read-only notices. Reuse existing components before extracting new ones.

Sports supply their surface, roles, labels, stat sections, event fields, optional
actions and checked command handlers through focused props/slots/capabilities.
Sport rules, eligibility, event construction and projection stay outside generic UI.
Capabilities must be derived from current authority and state, not used as a
substitute for command validation.

Do not force a universal event form, interchangeable substitution rules, or a
single sport configuration that promises features not implemented. Avoid large
shared components with per-sport conditionals. Extract where two real uses share
semantics; do not build speculative infrastructure for every future sport.

## Event and review integrity

Field dialogs and player-detail actions use the same sport commands. Corrections
remain revisioned, dependency-aware and subject to terminal/read-only restrictions.
Never mutate derived totals directly or merge independent recorder streams in UI.
Retain separate legacy adapters while legacy games remain supported.

## Clock and substitution goals

Confirmed goals: allow live lineup recording without an artificial recorder-clock
stop, allow displayed-clock corrections without retiming earlier facts, and accept
labelled timing imprecision where necessary. Scores, event counts and lineup-based
scoring attribution must remain deterministic.

The mechanism is NOT approved/implemented here. The existing
[timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) owns replay, participation
timing and recovery questions. System time must not replace recorder sequence as
the sole ordering authority. Preserve sport-specific eligibility and substitution
rules; a running recorder clock is not proof of what the rules permit.

## Adoption status

| Area | Current versus target |
| --- | --- |
| Soccer | Closest existing surface-first example; still audit gaps rather than declaring complete cross-sport parity |
| Basketball | Current strip/grid remains; next implementation is the linked workspace plan |
| Other sports | Follow these decisions when building their sport-specific experience; no migration scheduled here |
| Timing/replay | Separate architectural assessment, not part of the UI-only change |

Current execution proposal: [Basketball workspace modernization](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md).
