# Plan: SOC-4 Match Event Catalog

Detailed implementation plan for soccer defensive actions, discipline, team events,
shootouts, and structured match outcomes.

Status: SOC-4A implementation complete pending review. SOC-4B is next after merge.

---

## 1. Goal

Complete the locally usable core soccer event catalog on the shared event platform from
SOC-1 through SOC-3. Events must remain revisioned, removable/restorable, semantically
validated, projection-derived, compatible with parking, and editable through the unified
Timeline. Soccer remains development-only and local-only until SOC-6.

Cloud synchronization and independent-recorder resolution remain SOC-5. Summary, season
aggregation, settings, release hardening, and production enablement remain SOC-6.

---

## 2. Delivery Slices

### SOC-4A: Match event domain

Implementation status: Complete in `feature/soc-4a-match-event-domain`.

- Register the reviewed defensive, discipline, team, shootout, and outcome event schemas.
- Add semantic validation, deterministic projectors, derived totals, revisions, deletion,
  restoration, and malformed-history coverage.
- Keep unfinished capture controls hidden until their domain behavior is complete.

### SOC-4B: Defense, discipline, and team-event capture

- Add live and historical capture plus correction for normal-match defensive actions,
  fouls/cards, corners, offsides, and other reviewed core team events.
- Integrate all new events into the unified Timeline and applicable field review surfaces.
- Preserve compact mobile capture and existing SOC-2/SOC-3 workflows.

### SOC-4C: Shootouts and structured outcomes

- Add the dedicated shootout lifecycle, kick capture, correction, and shootout score.
- Keep shootout scoring separate from regulation/extra-time score and normal player totals.
- Add reviewed final match outcomes and lifecycle transitions without cloud finalization.

The three slices are implemented and reviewed sequentially.

---

## 3. Reviewed Decisions

1. SOC-4 is split into three phases: SOC-4A event schemas/projectors, SOC-4B normal-match
   defense/discipline/team-event capture, and SOC-4C shootouts plus structured outcomes.
2. The defensive core is tackle with a won/lost outcome, interception, clearance, and ball
   recovery. A shot block remains derived from the blocker linked to an opposing SOC-3 shot;
   SOC-4 must not add a duplicate standalone block event. Pressures, duels, aerial duels,
   dribbled-past events, and defensive errors remain optional future modules.
3. Defensive attribution is flexible. Tracked actions may use an eligible match participant,
   Team, or Unknown; historical participant attribution requires the participant to have been
   on field at the selected time. Opponent actions may use a recent/free-text player label,
   Team, or Unknown without introducing an opponent lineup.
4. Defensive actions use one `soccer.defensive_action` event. Its payload identifies
   `tackle`, `interception`, `clearance`, or `recovery`; tackle additionally requires a
   `won` or `lost` outcome, while the other action types have no synthetic outcome.
5. Defensive action location is optional. A field tap may start located capture, while quick
   actions may record an unknown location. Revision uses the shared location editor and may
   add, move, or clear the location without changing the stored event type.
6. The Field tab has an explicit capture-mode control. Capture mode and capture side are
   independent, the latest mode is persisted with the parked game, and field taps never depend
   on a hidden long-press or gesture convention. Decision 13 finalizes the mode catalog.
7. Attacking and defensive markers are displayed together by default. Team side remains
   encoded by the existing tracked/opponent colors, while distinct shapes encode event types
   and outcomes. The independent marker filter is `All | Shots | Defense | Incidents`, as
   finalized in Decision 17, and is not coupled to capture mode. Switching capture mode changes
   only what the next field tap records and does not reload the field.
8. A `soccer.foul` may include the committing actor's sanction when the foul and card form one
   incident. A standalone `soccer.card` represents a card without a foul or a card issued to a
   different recipient. Standalone recipients may be a player, named or unnamed coach/staff,
   or team/bench; non-player cards affect team discipline and Timeline only, never player stats.
9. Sanctions are `none`, `yellow`, `straight_red`, and `second_yellow_red`. A foul may have no
   sanction; a standalone card must have yellow, straight red, or second-yellow red. Warnings,
   temporary dismissals/blue cards, and competition-specific sanctions are deferred modules.
10. `second_yellow_red` requires an earlier active yellow for the same player in the same
    discipline scope. Normal/extra-time and shootout cautions use separate scopes. It derives
    one additional yellow and one red. Removing or revising the prerequisite yellow preserves
    the raw revision history but exposes a projection diagnostic until repaired.
11. The match rules snapshot supports both IFAB-style and NFHS-style yellow-card handling through
    an explicit policy: `stay_on` or `must_leave_may_replace`. Under the latter, an on-field
    tracked player's yellow prompts `Replace now` or `Play short`; immediate replacement records
    the card and substitution atomically, while playing short leaves the player eligible for a
    later legal re-entry under the match's return-substitution rules. Straight red and
    second-yellow red always eject the player without restoring the on-field count. A goalkeeper
    ejection may bring in a backup goalkeeper only while another field player leaves, preserving
    the one-player reduction and exactly one on-field goalkeeper. Competition-specific red-card
    replacement and temporary-dismissal/sin-bin rules remain future rule modules.
12. A foul stores its restart outcome as `direct_free_kick`, `indirect_free_kick`, `penalty`,
    `advantage`, or `none`. The restart is part of the same foul sheet and event, not a second
    capture step or event; live capture defaults to direct free kick so the common path adds no
    tap. Penalties won/conceded derive from `penalty`. A later shot from the restart remains a
    separate SOC-3 shot with its existing penalty/direct-free-kick situation.
13. Field capture modes are `Shot | Defense | Foul`. A field tap opens that event family's
    sheet with the normalized location; the latest mode is parked with the game. Quick Foul
    remains available below the field for unknown-location entry. All marker families remain
    visible together by default, so capture-mode changes never hide or reload prior events.
14. A standalone card starts from a Quick Card action below the field and records recipient,
    sanction, and time in one sheet. Player incidents may optionally open the shared field
    location picker; coach/staff and team/bench cards default to no location. Cards do not add
    a fourth field capture mode.
15. Corners and offsides use one `soccer.team_event` schema with `corner` or `offside` kind.
    `teamSide` means the side awarded a corner or the side committing an offside. Offside may
    identify an optional player/Team/Unknown actor; core corner attribution remains team-level.
    Foul restart outcomes remain on the foul event rather than being folded into this schema.
16. Corner and offside live capture starts from one Quick Team Event sheet below the field.
    Both support optional shared field-location selection. Corner offers attacking left/right
    corner shortcuts; offside supports its optional actor. Neither adds another field mode or
    a permanently visible dedicated button for each event kind.
17. Every located normal-match event may appear together on the field. The marker-family filter
    is `All | Shots | Defense | Incidents`, where Incidents contains located fouls, standalone
    cards, corners, and offsides. Existing tracked/opponent colors retain side meaning and
    event-specific shapes retain action meaning; side and period/full-match filters still apply.
18. The unified newest-first Timeline uses one event-family filter menu with `All`, `Attacking`,
    `Defensive`, `Discipline`, `Team Events`, and `Match Control`. Existing revision, removal,
    restoration, historical add, diagnostics, and period-local time behavior applies to every
    SOC-4 event family; SOC-4 does not create separate Timeline tabs.
19. SOC-4 derives tackles attempted/won/lost and win rate, interceptions, clearances, ball
    recoveries, SOC-3 linked shot blocks, fouls committed/drawn, yellow/red cards, corners,
    offsides, and penalties won/conceded. Rates are calculated from derived counts. Attributed
    tracked participants receive player totals; Team/Unknown attribution contributes only to
    side totals and never invents player credit. Advanced defensive modules remain deferred.
20. Timeline has one `Add Event` chooser for Shot, Defense, Foul, Card, and Team Event. The
    selected family reuses its live/correction sheet with period-local time controls and
    historical actor/lineup/role validation. Shootout additions and corrections stay inside the
    dedicated shootout workflow rather than the normal-match chooser.
21. Shootout entry is explicit and allowed only when the match snapshot enables shootouts, every
    configured regulation/extra-time segment is complete, and the normal match score is tied.
    The recorder chooses `Start Shootout`; the app does not auto-enter shootout mode or permit a
    shootout to mask an incomplete lifecycle or incorrect score.
22. Starting a shootout snapshots the tracked participants eligible when normal play ends and
    presents a pre-kick include/exclude review for competition-specific eligibility. Tracked
    kicks prefer a participant in that frozen set but permit Team/Unknown fallback. Opponent
    kickers remain recent/free-text labels, Team, or Unknown because SOC core has no opponent
    lineup. Eligibility changes after the first kick require revision of shootout setup history.
23. Shootout setup records the first-kicking side and configurable initial kick count, defaulting
    to five per side. Projection alternates sides, detects an insurmountable initial-series lead,
    enters sudden-death rounds when still tied, and determines when a winner exists. Kick events
    remain individually revisioned; correcting setup or an earlier kick deterministically
    rebuilds order, score, clinching state, and diagnostics.
24. Each `soccer.shootout_kick` stores a reviewed outcome plus kicker and defending goalkeeper
    when known. Tracked actors use eligible match participants where applicable; opponent actors
    use labels, Team, or Unknown. Shootout score, attempts, goals, and saves are projected
    separately and never increment normal shots, goals, assists, goalkeeper saves/goals allowed,
    or regulation/extra-time score. Decision 30 completes the outcome catalog.
25. The recorder ends normal play with `completed`, `suspended`, or `abandoned`. Suspended and
    abandoned remain explicit outcomes. For a completed match, projection derives winner/draw,
    regulation versus extra-time versus shootout stage, normal score, and shootout result from
    the corrected event stream and snapshotted rules. Recorder-selected winner/stage fields and
    administrative forfeits are not part of SOC-4.
26. Match rules snapshot one tie-resolution path: `draw_allowed`,
    `extra_time_then_shootout`, or `direct_to_shootout`. The tracker offers only valid next
    stages and rejects `completed` while a winner-required match is tied and unresolved. A
    direct-to-shootout format does not create synthetic extra-time periods.
27. `suspended` stops the clock and active period but offers an explicit later `Resume Match`
    transition against the same parked event history. `abandoned` is terminal unless the
    recorder deliberately reopens it for correction with a required reason. Neither status
    silently finalizes or uploads the game; cloud finalization remains SOC-5.
28. Shootout mode uses a dedicated in-tracker workspace with normal score plus separate shootout
    score, ordered kick sequence, next-kicker/goalkeeper capture, and large outcome controls.
    Timeline remains available and the normal field remains review-only; shootout capture is not
    a long-lived modal and does not use normal Timeline Add Event.
29. Shootout discipline is a separate caution scope: normal/extra-time warnings and yellows do
    not satisfy a shootout second-yellow prerequisite. Quick Card remains available in the
    shootout workspace. A shootout player red removes that player from eligibility and requires
    the opposing side to exclude one eligible player; a sent-off goalkeeper is replaced only by
    an eligible shootout participant. Staff cards do not change participant pools. Corrections
    reproject cautions, eligibility, equalization, and later-kick diagnostics.
30. Shootout kick outcomes are `scored`, `saved`, `missed`, `woodwork`, `retake`, and
    `forfeited`. The four final attempt outcomes advance the sequence; `retake` preserves the
    same side, kicker, and sequence slot for another attempt; `forfeited` advances as not scored.
    Every raw attempt remains visible and revisioned, including an attempt ordered retaken.
31. A shootout goalkeeper change is an explicit revisioned event before the next kick. Normal
    changes select another eligible participant. When a goalkeeper is unable to continue and
    the competition rules permit an unused substitute, a reviewed eligibility-change event may
    add the replacement and excludes the former goalkeeper. Per-kick goalkeeper selection may
    default from this state but cannot silently rewrite goalkeeper lifecycle.
32. When projection determines that the shootout is mathematically decided, it exposes the
    winner, disables another kick, and presents `Complete Match`. The recorder confirms an
    explicit completion event rather than ending the match as a side effect of kick capture.
    Revising setup or a kick may reopen the sequence when the winner is no longer determined.
33. SOC-3 shots with penalty, direct-free-kick, or corner-sequence situation may store an
    optional source-event reference to a recent qualifying foul or corner. Capture suggests a
    compatible event but the recorder may change or clear it; linking is never required and does
    not alter independently derived restart or shot totals. Revisions/removal preserve raw links
    and expose a diagnostic for an invalid active relationship rather than silently relinking.
34. Field review clusters markers at the same or visually overlapping coordinates rather than
    shifting stored locations or hiding older events. A cluster displays its event count and
    opens a compact event list; choosing a row opens that event's existing family editor. Marker
    family, side, period, and match filters apply before clustering.
35. The fouled actor is optional and side-aware. An opponent foul may identify an eligible
    tracked participant, Team, or Unknown; a tracked foul may identify an opponent label, Team,
    or Unknown. Historical tracked attribution requires on-field eligibility at that time. Only
    participant attribution derives a player foul-drawn total; Team/Unknown remains side-level.
36. Match setup offers editable IFAB and U.S. High School starting profiles. The recorder reviews
    and may customize the individual yellow-exit, return-substitution, red-card, tie-resolution,
    and related competition settings before kickoff. The match snapshots resolved fields rather
    than a mutable profile name, so profile changes never rewrite parked or historical games.
37. Foul sanctions and standalone cards store a sanction-appropriate structured reason plus an
    optional note. Core reasons include dissent, unsporting behavior, persistent offenses,
    delaying restart, failure to respect distance, unauthorized entry/exit, serious foul play,
    violent conduct, DOGSO, abusive language, second caution, and `other_not_recorded`. Reason
    provides Timeline context and filtering metadata but creates no additional SOC-4 statistic.
38. Below-field unknown-location capture uses a compact icon toolbar for Goal, Foul, Card, and
    Team Event, all targeting the currently selected tracked/opponent side. It replaces the two
    separate Quick Goal buttons. Each command opens its family sheet prefilled for speed and does
    not append blindly; the recorder confirms attribution and event-specific fields before save.
39. One parked live tracked-participant selection supplies the default shooter, defender, foul
    committer, player-card recipient, or offside actor where applicable. A family sheet may
    override it, and the last eligible tracked participant used becomes the next shared default.
    Team/Unknown remain explicit choices. Historical add/correction never changes the live
    default, and an ineligible participant is cleared rather than silently replaced.
40. Shootout setup snapshots an opponent eligible-player count, defaulted to the tracked eligible
    count and explicitly adjustable by the recorder. The tracked pool must be reduced to equal
    a smaller opponent count. Opponent actors remain label/Team/Unknown identities learned as
    events occur; opponent send-offs/unavailability decrement the count and trigger a matching
    tracked exclusion without inventing an opponent roster.
41. Shootout projection enforces kicker uniqueness for both sides within each eligible-player
    round. Known opponent labels cannot repeat early. Team/Unknown kicks consume stable numbered
    anonymous slots up to the snapshotted opponent count; a retaken attempt does not consume a
    new slot. This validates order without requiring opponent names or a synthetic roster.

---

## 4. Rules and Compatibility Contract

SOC-4 extends `SoccerMatchRules` with resolved fields rather than storing a mutable profile name:

```text
yellowCardExitPolicy: stay_on | must_leave_may_replace
redCardReplacementPolicy: play_short
tieResolution: draw_allowed | extra_time_then_shootout | direct_to_shootout
shootoutInitialKicksPerSide: positive integer, default 5
allowUnusedGoalkeeperShootoutReplacement: boolean
```

`redCardReplacementPolicy` is explicit for forward compatibility, but SOC-4 accepts only
`play_short`. The IFAB and U.S. High School choices in setup are editable presets that populate
these resolved fields plus the existing period, return-substitution, and substitution settings.
They are never persisted as rule authority.

`SoccerSportGameState` advances to version 2. `normalizeSportGameState` backfills old local SOC-2
and SOC-3 snapshots:

- legacy `shootoutAvailable: false` becomes `draw_allowed`;
- legacy `shootoutAvailable: true` plus `extraTimeAvailable: true` becomes
  `extra_time_then_shootout`;
- legacy `shootoutAvailable: true` plus `extraTimeAvailable: false` becomes
  `direct_to_shootout`;
- missing yellow policy becomes `stay_on`;
- missing capture mode becomes `shot`;
- missing shootout kick count becomes five.

The legacy availability booleans may remain readable during normalization, but new state and
validation use `tieResolution` as lifecycle authority. Existing event streams are not rewritten.
The optional source link added to a SOC-3 shot is backward-compatible within shot schema version
1, so SOC-4 must not increment the global soccer event version and accidentally invalidate every
older event type.

---

## 5. Event Schemas

Every event retains the shared envelope, revision, deletion, recorder sequence, normalized
location, actor list, and projection-diagnostic behavior from SOC-1. Normal-match incidents use a
started regulation/extra-time period and integer canonical `elapsedMs`. Shootout events use a
synthetic `{ id: "shootout", order: lastSegmentOrder + 1 }` period and `elapsedMs: null`; kick
order comes from recorder sequence, not a fabricated match clock.

### 5.1 Defensive action

```text
eventType: soccer.defensive_action
teamSide: side performing the action
location: optional
payload:
  action: tackle | interception | clearance | recovery
  tackleOutcome: won | lost | null
actors:
  defender: required participant | team | unknown
```

`tackleOutcome` is required only for tackle and must be null otherwise. A tracked participant
must be on field at the event moment. Opponent player labels remain game-local unknown actors.
Shot blocks do not create this event; the existing `blocker` actor on a blocked shot is their sole
event authority.

### 5.2 Foul

```text
eventType: soccer.foul
teamSide: side committing the foul
location: optional
payload:
  restart: direct_free_kick | indirect_free_kick | penalty | advantage | none
  sanction: none | yellow | straight_red | second_yellow_red
  sanctionReason: discipline reason | null
  note: trimmed string | null
  lineupResolution: discipline lineup resolution | null
actors:
  committed_by: required participant | team | unknown
  fouled: optional participant | team | unknown
```

The fouled actor belongs to the opposite side. `sanctionReason` is null for no sanction and
required otherwise. If a sanction belongs to another recipient, the foul remains unsanctioned
for that actor and a standalone card records the other recipient.

### 5.3 Standalone card

```text
eventType: soccer.card
teamSide: recipient side
location: optional for player incidents; normally null for staff/team/bench
payload:
  sanction: yellow | straight_red | second_yellow_red
  reason: discipline reason
  note: trimmed string | null
  lineupResolution: discipline lineup resolution | null
actors:
  recipient: required player | staff | team | unknown
```

Core discipline reasons are:

```text
dissent | unsporting_behavior | persistent_offenses | delaying_restart
failure_to_respect_distance | unauthorized_entry_exit | serious_foul_play
violent_conduct | dogso | abusive_language | second_caution | other_not_recorded
```

`second_yellow_red` requires `second_caution` and an earlier active yellow for the same player in
the same discipline scope. Normal/extra-time and shootout cautions are separate scopes. Staff,
team, bench, and opponent-label cards never mutate tracked lineup or player totals.

### 5.4 Discipline lineup resolution

For a tracked participant, foul/card payload may carry one atomic consequence:

```text
cardedParticipantId: stable match participant id
exit: none | temporary | ejected
replacementChanges: existing SoccerSubstitutionChange[]
countsAsSubstitutionWindow: boolean
```

- `stay_on` yellow requires `exit: none`.
- `must_leave_may_replace` yellow requires `temporary`; replacement is either empty (play short)
  or one entry-only change for a bench player.
- red requires `ejected`; a non-goalkeeper has no replacement.
- goalkeeper red may atomically remove one field player and enter a backup goalkeeper, ending
  with exactly one goalkeeper and one fewer total on-field participant.

The incident and its lineup consequence are one event so revision/removal cannot separate a card
from the forced exit. Substitution/window counters use the existing match rules and helper logic.

### 5.5 Team event

```text
eventType: soccer.team_event
teamSide: corner beneficiary or offside offender
location: optional
payload:
  kind: corner | offside
actors:
  offside_player: optional participant | team | unknown; forbidden for corner
```

Corner location shortcuts normalize the attacking left/right corner using capture-time direction.

### 5.6 Optional shot source

`SoccerShotPayload` adds optional `sourceEventId: string | null`. Validation requires:

- penalty or direct-free-kick shots reference an earlier active foul whose restart matches and
  whose committing side is opposite the shooting side;
- corner-sequence shots reference an earlier active corner for the shooting side;
- source and shot share a period, and source elapsed time does not exceed shot time;
- open-play/other-set-piece shots have no source;
- one source may support multiple shots; no implicit relinking occurs after correction/removal.

### 5.7 Shootout start and eligibility

```text
eventType: soccer.shootout_started
payload:
  firstKickingSide: tracked | opponent
  initialKicksPerSide: positive integer
  trackedEligibleParticipantIds: unique ids
  trackedExcludedParticipantIds: unique ids
  opponentEligibleCount: positive integer
  trackedGoalkeeperParticipantId: participant id
actors: none
```

```text
eventType: soccer.shootout_eligibility_changed
payload:
  reason: equalization | sent_off | unable_to_continue | goalkeeper_replacement
  trackedEligibleParticipantIds: complete revised set
  trackedExcludedParticipantIds: complete revised set
  opponentEligibleCount: positive integer
actors: optional affected/replacement actors for readable history
```

Start is valid only after every required normal segment, a tied normal score, and the configured
winner-required path. Eligible tracked ids begin from the final on-field set and must equal the
opponent count after exclusions. Once the first kick exists, eligibility changes require an
explicit event; setup is never silently mutated.

### 5.8 Shootout goalkeeper change

```text
eventType: soccer.shootout_goalkeeper_changed
teamSide: side changing goalkeeper
payload:
  reason: tactical | unable_to_continue | sent_off
actors:
  goalkeeper_out: required participant | unknown
  goalkeeper_in: required participant | unknown
```

Tracked tactical changes remain inside the eligible pool. An unused tracked substitute may enter
only for an unable goalkeeper when the snapshotted rule and remaining substitution allowance
permit it; a paired eligibility event excludes the former goalkeeper. A sent-off goalkeeper is
replaced by an already eligible participant.

### 5.9 Shootout kick

```text
eventType: soccer.shootout_kick
teamSide: projected next side
payload:
  outcome: scored | saved | missed | woodwork | retake | forfeited
  anonymousKickerSlot: positive integer | null
actors:
  kicker: required participant | team | unknown
  goalkeeper: required participant | unknown
```

Projection derives kick number, initial-series position, sudden-death round, and whether the
attempt advances. `retake` keeps the same side, kicker identity/anonymous slot, and kick slot.
`forfeited` advances as not scored. A participant/known label cannot repeat before every eligible
slot has kicked in that round. Anonymous opponent kicks consume stable numbered slots.

The goalkeeper actor is required for every raw kick event, including `retake` and `forfeited`.
It identifies the defending goalkeeper designated for that attempt or slot; `unknown` preserves
the requirement when the recorder cannot identify that goalkeeper. This keeps goalkeeper state
and correction behavior uniform without treating a forfeited kick as a normal save opportunity.

No new shootout-completed payload stores a winner. Once projection says the sequence is decided,
the existing `soccer.match_ended` with `completed` becomes the explicit completion event and
derives the winner from shootout state.

---

## 6. Projection Model

### 6.1 Multi-pass projection

SOC-4 cannot treat every new event as a simple sequence-ordered counter. A historical or revised
card can change who was on field before later events. `projectSoccerMatchEvents` therefore gains
explicit passes:

1. **Envelope and lifecycle pass:** validate recorder sequence, period bounds, clock anchors,
   period transitions, rules changes, suspension/abandonment, and shootout boundary in capture
   order.
2. **Temporal lineup pass:** replay opening lineup, substitutions, role changes, roster additions,
   and tracked discipline lineup resolutions by period order, effective `elapsedMs`, deterministic
   event priority, then recorder sequence. Discipline exit precedes its same-time replacement.
3. **Incident/stat pass:** validate normal incidents against the finalized on-field/role intervals,
   validate links and caution prerequisites, then derive participant/side totals.
4. **Shootout pass:** project setup, eligibility, separate cautions, goalkeeper state, kick order,
   score, clinching, sudden death, and completion strictly in capture order.

Any failed event preserves raw history, emits the existing semantic diagnostic, and marks later
dependent events unprojected. New appends still require a complete resulting projection; revisions
may preserve an incomplete state so Timeline can repair it.

### 6.2 Match state

`SoccerMatchStatus` becomes:

```text
not_started | in_progress | period_break | shootout | suspended | ended
```

Projection adds:

```text
endReason: completed | abandoned | null
suspendedContext: { periodId, elapsedMs } | null
result: tracked_win | opponent_win | draw | suspended | abandoned | unresolved
decidedStage: regulation | extra_time | shootout | null
shootout: null | SoccerShootoutProjection
```

`soccer.match_ended(suspended)` projects `suspended`, preserves the stopped period/time context,
and closes active intervals. Existing `soccer.match_reopened` means Resume Match from suspended
and returns to that stopped period; from completed/abandoned it remains an explicit correction
reopen with required reason and returns to the appropriate break. Abandoned remains terminal in
normal UI. Completed is rejected when tie resolution still requires extra time or shootout.

### 6.3 Normal totals

Participant totals add:

```text
tacklesAttempted, tacklesWon, tacklesLost
interceptions, clearances, recoveries, blockedShots
foulsCommitted, foulsDrawn, yellowCards, redCards
```

Side totals add the same count families plus corners, offsides, penaltiesWon, penaltiesConceded,
staffYellowCards, staffRedCards, and team/unknown-attributed counts. Tackle win rate is calculated
from won/attempted and never persisted. Linked SOC-3 blocker actors are the source for
`blockedShots`. Shootout attempts/goals/saves/cards live only in `SoccerShootoutProjection`.

`buildProjection` maps attributed tracked participant counts to `soc_*` stat keys for eventual
SOC-5/SOC-6 publication. Team/Unknown actors change only side totals. SOC-4 does not publish new
season aggregates or cloud rows.

---

## 7. Normal-Match UI

### 7.1 Field workspace

```text
Tracked | Opponent side
shared tracked participant carousel when applicable
Shot | Defense | Foul capture mode
marker filters: All | Shots | Defense | Incidents
side filter + Current/Match scope
full field with all selected markers and clusters
quick toolbar: Goal | Foul | Card | Team Event
```

Capture mode changes only the next field tap; it does not change marker visibility. It and the
shared live participant default are parked in `SoccerCapturePreferences`. Quick toolbar commands
target the selected side and open a prefilled sheet before saving.

Marker color continues to mean side. Existing attacking outcome shapes remain; defensive and
incident types receive distinct shapes plus an accessible label/legend. Filtering occurs before
proximity clustering. A cluster opens a compact event list, then the family editor. Display flip
rotates markers but never stored coordinates.

### 7.2 Family sheets

SOC-4B adds focused bottom sheets for Defense, Foul, Card, and Team Event. They reuse shared actor,
period-local time, side, location-picker, recent opponent-label, and error primitives from the
SOC-3 attacking editor where that removes real duplication. Each sheet supports live,
historical, and same-event-type revision modes and fails closed between those operations.

Foul defaults restart to direct free kick. NFHS-style tracked yellow opens an inline lineup
resolution step. Red requires the ejection consequence before save. Standalone staff/team cards
use labeled actors without creating roster players. Team Event offers left/right corner shortcuts
and optional offside actor.

### 7.3 Timeline

Rename the implementation component from `SoccerMatchHistory` to `SoccerTimeline` while preserving
the route and user-visible Timeline behavior. Replace the three-option segmented filter with a
compact menu: All, Attacking, Defensive, Discipline, Team Events, Match Control. `Add Event` opens
one family chooser and then the shared historical sheet. Removed events stay collapsed and filter
aware. Source links, sanction/restart detail, lineup consequence, and shootout sequence context are
readable without opening correction.

---

## 8. Shootout and Outcome UI

Start Shootout appears only at the valid final break. Its setup sheet reviews first side, initial
kick count, tracked eligibility/exclusions, opponent count, and both goalkeepers.

The dedicated workspace replaces normal capture controls:

```text
normal score (read-only) + separate shootout score
initial series / sudden-death status and eligible counts
ordered kick strip with outcome and revision state
next side, kicker, goalkeeper, and large outcome controls
Quick Card and Change Goalkeeper commands
Complete Match only after projection determines a winner
```

The Field remains review-only and Timeline remains reachable. Tapping a kick opens correction;
removed/retaken/forfeited attempts remain visible. A correction that removes the winner returns to
the next valid kick. Kick capture can never mutate normal score or ordinary player/goalkeeper
totals.

At the final normal period break, lifecycle commands follow `tieResolution`:

```text
draw_allowed              -> Complete Draw
extra_time_then_shootout  -> Start Extra Time, then Start Shootout if still tied
direct_to_shootout        -> Start Shootout
```

Non-tied completed matches derive regulation/extra-time winner. Suspend is available from active
play; Resume restores its exact stopped context. Abandon requires confirmation and remains
reopenable only through Timeline correction with a reason.

---

## 9. Delivery Plan

### SOC-4A: Match event domain

Primary files:

- `src/lib/soccer/types.ts`, `events.ts`, `projector.ts`, `state.ts`, `rules.ts`,
  `setupRules.ts`, and `live.ts`;
- focused new pure modules such as `discipline.ts` and `shootout.ts` only where they isolate the
  temporal/sequence algorithms;
- `src/lib/soccer/*.test.ts` plus migration/normalization fixtures.

Work:

1. Add version-2 rules/state normalization and capture preference defaults.
2. Register all SOC-4 payloads, unions, validators, actor-role constraints, and shot source link.
3. Refactor projection into lifecycle, temporal-lineup, incident, and shootout passes.
4. Add normal and shootout totals, outcome derivation, suspension/resume, and tie-resolution gates.
5. Add checked live/historical/revision APIs without exposing unfinished controls.
6. Prove deterministic rebuild, revision/delete/restore, malformed history, and compatibility.

Exit: every reviewed event and lifecycle transition can be created through pure APIs, round-trips
parked state, and deterministically rebuilds complete projections; no unfinished UI is visible.

### SOC-4B: Normal-match capture and review

Primary files:

- `src/pages/SoccerGameSetup.tsx`, `SoccerGameTracker.tsx`;
- `src/components/soccer/SoccerField.tsx`, renamed `SoccerTimeline.tsx`, and the SOC-3 attacking
  editor;
- new focused Defense, Foul, Card, Team Event, Add Event, and marker-cluster components;
- `src/lib/soccer/field.ts` and reducer/capture-preference handling in `GameContext` as needed.

Work:

1. Add editable IFAB/High School setup profiles and resolved rule controls.
2. Add three field modes, selected-side toolbar, shared actor defaults, and all-family markers.
3. Add family sheets with location, lineup consequence, live/historical/edit, and source-link UX.
4. Expand Timeline filters, labels, Add Event, revision, remove/restore, and diagnostics.
5. Verify park/resume, current/full-match filters, clusters, mobile ergonomics, and basketball.

Exit: defense, foul/discipline, corner, and offside workflows are usable and correct locally from
live capture through historical correction, with no shootout UI exposed.

### SOC-4C: Shootout and structured outcome workspace

Primary files:

- `src/pages/SoccerGameTracker.tsx` and setup lifecycle controls;
- new `SoccerShootoutWorkspace`, setup, kick, eligibility, goalkeeper, and correction components;
- `src/components/soccer/SoccerTimeline.tsx` for shootout rows;
- `src/lib/soccer/shootout.ts`, `live.ts`, projector/state/rules tests.

Work:

1. Add valid Start Shootout and dedicated workspace.
2. Add eligibility/equalization, kicker rounds, retakes/forfeits, goalkeeper changes, and separate
   discipline scope.
3. Add clinching/sudden-death projection, explicit completion, correction reopening, and outcomes.
4. Add suspended resume and abandoned correction UX.
5. Complete responsive, parking, lifecycle, and cross-sport regression coverage.

Exit: a tied winner-required local match can complete a corrected shootout and derive an accurate
structured result without affecting normal score/stat totals.

---

## 10. Test and Regression Matrix

### SOC-4A automated

- every action, restart, sanction, reason, actor kind, side, and legal location combination;
- tackle outcome conditional validation and linked-block non-duplication;
- foul/card player, Team, Unknown, staff, bench, and opponent-label totals;
- yellow stay-on, yellow leave/replace, play-short/re-entry, red, second-yellow prerequisite,
  goalkeeper-red handoff, and correction/removal of prerequisites;
- historical discipline before later substitutions/roles/shots using temporal replay;
- corner/offside attribution and optional shot-source validity;
- rules v1-to-v2 normalization and legacy SOC-2/SOC-3 event rebuild;
- draw, extra-time, direct-shootout, suspended, resumed, abandoned, completed lifecycle;
- eligibility equalization, alternating order, anonymous slots, retake, forfeit, early clinch,
  sudden death, goalkeeper change, separate cautions, send-off, and completion reopening;
- randomized rebuild determinism and failed append atomicity.

### SOC-4B manual/browser

- 390x844 and desktop widths with no overlap or page-level horizontal scrolling;
- field mode/side/player persistence across park/resume;
- simultaneous markers, every filter, flip, cluster selection, and family correction;
- quick toolbar and located capture for each side/family;
- NFHS yellow replace-now/play-short and goalkeeper red resolution;
- Add Event across started periods, invalid historical actor diagnostics, remove/restore;
- source suggestion/change/clear and source removal diagnostic;
- basketball court, assist/rebound prompts, parking, summary, and cloud paths unchanged.

### SOC-4C manual/browser

- each tie-resolution path and invalid start gate;
- tracked eligibility review, opponent count, exclusions, known/anonymous kicker uniqueness;
- all kick outcomes, retake, forfeit, early clinch, and sudden death;
- shootout card scope, red equalization, goalkeeper change/replacement;
- correction/remove/restore before and after a deciding kick;
- separate normal/shootout score and stats after park/resume;
- suspend/resume and abandon/reopen;
- mobile/desktop shootout workspace and Timeline readability.

Add SOC-4 sections to `docs/REGRESSION_TESTING.md` in each implementation PR rather than claiming
unbuilt manual coverage in this planning PR.

---

## 11. Persistence, Cloud, and Release Boundary

SOC-4 writes only the existing local `eventStream`, `sportGameState`, and parked-game records.
Game parking already serializes those structures; version normalization is the only storage
change. Import/export inherits the same normalized state. No Supabase migration is required in
SOC-4 because production soccer cloud synchronization, recorder-stream ownership, finalization,
and aggregate publication remain SOC-5.

Soccer stays development-only through SOC-4. Production routing, settings exposure, summary maps,
season aggregates, and supported-sport enablement remain SOC-6. SOC-4 must not write partial soccer
stats through basketball's legacy mutable counters or cloud game-stat paths.

---

## 12. Explicit Deferrals

- pressures, ground/aerial duels, dribbled-past events, defensive errors, and detailed possession;
- goalkeeper claims, punches, distribution, sweeper actions, save technique, and handling detail;
- routine throw-ins, goal kicks, and free-kick counts independent of a foul;
- temporary-dismissal/sin-bin and competition-specific red-card replacement;
- automatic suspension/eligibility across future games and administrative forfeits;
- opponent roster creation or season player attribution from free-text labels;
- expected goals, body part, detailed buildup, and automated restart-chain inference;
- cloud sync/finalization (SOC-5) and summaries/season standings/release (SOC-6).

---

## 13. Merge and Review Order

1. Merge SOC-4A and pull `stattracker` before branching SOC-4B.
2. Merge SOC-4B and pull before branching SOC-4C.
3. Keep each PR limited to its listed exit condition; review comments that require later UI,
   cloud, or release behavior are documented and deferred to the owning phase.
4. After SOC-4C, update this document to Complete and hand implementation to SOC-5 planning.

No further product Q&A is required before SOC-4B. Implementation questions should follow the
locked decisions and conservative codebase patterns above.
