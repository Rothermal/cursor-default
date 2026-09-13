# Event Timing and Live Lineups

Status: architectural assessment and proposed direction; implementation scope and
product questions are not yet approved. No runtime changes in this document.

## Confirmed goals

- Permit lineup recording without requiring the recorder's game clock to stop.
- Permit game-clock corrections without editing all earlier events.
- Accept some playing-time inaccuracy in exchange for a usable live workflow.
- Preserve event facts, actor identity, eligibility, and deterministic replay.
- Design shared concepts for multiple sports without imposing one sport's
  substitution rules on another. Recorder-clock state is not a rules official.

## Current architecture

The event envelope already separates several concepts. This is primarily a
replay and timing-policy change, not a missing timestamp field.

| Concern | Current implementation | Consequence |
| --- | --- | --- |
| Event identity and capture order | `src/lib/gameEvents/types.ts` defines ID, recorder, sequence and revision; `stream.ts` defines capture-order comparison by sequence then ID | Keep stable per-recorder ordering; system time should not replace it |
| Clock and timestamps | Envelope contains period, `elapsedMs`, `occurredAt`, `createdAt`, and `updatedAt` | `occurredAt` is editable, so it must not be described as an immutable recording receipt |
| Display ordering | `compareGameEvents` compares period, elapsed value, sequence, ID; fingerprint serialization also uses it | Audit each comparator consumer rather than replacing sorting globally |
| Soccer lineup manager | `soccer/lineupManager.ts` blocks a running clock; `live.ts` and `projector.ts` require a stopped clock for `soccer.lineup_transition` | Removing only the UI guard will still fail |
| Older Soccer substitution | `soccer/projector.ts` allows the older substitution-window path without requiring a stopped clock; `targetLineup.ts` contains running-clock interval handling | A focused live-lineup change is plausible without replacing the envelope |
| Soccer correction | `soccer/projector.ts` rejects clock corrections before participant entry boundaries | Display time and participation accounting currently share the same coordinate |
| Basketball clock | `basketball/clockProjection.ts` validates event elapsed values against clock anchors; `clockCommands.ts` pauses before adjustment | Timestamp metadata currently participates in event validity |
| Basketball lineup | `basketball/lineupCommands.ts` and `lineupProjection.ts` constrain running-clock changes | Requires coordinated command and replay changes, not just a dialog update |
| Basketball minutes | `splitLineupsAtAdjustment` in `basketball/lineupProjection.ts` trims derived intervals on backward adjustment | Raw events remain, but prior derived participation can change |
| Recorded-later Basketball lineups | `basketball/lineupReplay.ts` inserts these into effective replay positions using period, elapsed time and precedence | Capture order alone does not describe all historical lineup semantics |

Existing corrections already use events rather than rewriting every prior raw
event. The problem is that clock values constrain replay and derived intervals.

## Recommended separation

1. **Capture identity/order:** preserve IDs and recorder sequence. Wall time is
   useful context, but device changes, offline recording and delayed entry make
   it unsuitable as the sole ordering authority. Separate recorder streams must
   not become a global wall-clock-ordered stream.
2. **Recording timestamps:** retain creation/update provenance and document the
   distinct meaning of editable occurrence time. Avoid redundant fields until
   existing constructor and transport semantics have been fully audited.
3. **Game-clock snapshot:** retain period and displayed clock context on each
   event. A correction changes the current clock and future captures; it does
   not automatically retime earlier facts. Repeated clock readings are valid.
4. **Participation timing:** propose a separate accumulated active-time basis,
   excluding recorded pauses, that does not move backward when display time is
   corrected. Freeze completed timing contributions; label uncertain results
   as estimated. Exact representation and recovery policy need planning.

The fourth item is a recommendation, not an approved schema. Simply calculating
minutes from wall-clock differences would incorrectly count breaks and parking.
Restart/reload and device-time discontinuities need bounded recovery behavior;
do not silently accumulate implausible durations.

Scores and event counts should remain exact. Plus-minus depends on the lineup
effective at each scoring event, not minute precision, and should remain
deterministic. Historical insertion still needs an unambiguous effective
position when the displayed clock has repeated a value.

## Proposed work boundaries

### Focused live-lineup work

Start with Soccer's current target-lineup manager. Coordinate UI, checked command
and projector support for running-clock submission. Timestamp the change when
Apply succeeds, not when the editor opens. Revalidate the latest lineup,
eligibility and match state at commit; stale drafts must not overwrite intervening
changes. Keep bulk changes atomic and retain ejection, roster-size, goalkeeper,
return-substitution and short-lineup protections as applicable.

This is the smaller candidate slice. Confirm compatibility with old clients and
recovery/replay before enabling it; existing support in the older substitution
path does not prove the newer event can be enabled without compatibility work.

### Clock independence

Define future-only correction semantics and participation estimates before
changing validators. Apply the model to Soccer and Basketball with shared
primitives where genuinely equivalent. Do not remove all timestamp validation:
malformed data, period boundaries, lifecycle state and authorization still matter.

### Compatibility and downstream consumers

Choose explicit timing-policy/version boundaries rather than silently changing
the interpretation of old games. Audit historical edits, Undo/Restore, summaries,
minutes, plus-minus, aggregates, parking, conflict recovery and canonical
publication. Existing finalized sources must not acquire different totals merely
because a new client replays them.

Detailed database constraints, RPC payload validation, capability negotiation and
migration requirements are a follow-up assessment. No claim of migration-free
implementation is made here. Preserve existing legacy aggregate games.

These are work boundaries, not a commitment to three PRs. Group implementation
by coherent reviewable behavior after the contracts are settled.

## Next planning decisions

- Confirm future-only clock edits: earlier event clock labels stay unchanged.
- Confirm Apply-time live substitutions, with optional historical correction
  handled separately rather than inferred from how long an editor was open.
- Choose how estimated minutes are labeled and handled after reload, parking or
  unreliable device time.
- Choose whether the new timing policy starts with new games only, and how
  historical lineup edits identify their effective position after clock changes.

## Verification requirements

- Running and paused bulk substitutions, role changes and default-lineup restore.
- Editor held open while another event, period change or lineup change occurs.
- Forward/backward clock corrections across participant entry and exit boundaries.
- Identical clock readings on distinct events; deterministic scoring-lineup order.
- Pause/resume, period changes, countdown/count-up display and clock expiration.
- Reload/park/resume, offline work and device-time jumps without negative minutes.
- Recorded-later lineup edits and dependent Undo/Restore after clock correction.
- Independent recorder streams, sync/recovery and finalization with unchanged facts.
- Old-game replay and existing canonical publications retain their prior meaning.

## Assessment conclusion

The requested direction is feasible. Soccer live-lineup support is a narrower
change; full clock independence crosses replay, participation and compatibility
boundaries and should not be treated as a UI-only patch. The existing envelope
and stable recorder sequence provide a useful foundation without making wall
time the new source of truth for everything.
