# Plan: SOC-4 Match Event Catalog

Detailed implementation plan for soccer defensive actions, discipline, team events,
shootouts, and structured match outcomes.

Status: Q&A complete. Reviewed decisions are locked; detailed implementation synthesis is next.

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
   encoded by the existing tracked/opponent colors, while distinct shapes encode attacking
   outcomes and defensive action types. An independent `All | Attack | Defense` marker filter
   may reduce clutter but is not coupled to capture mode. Switching capture mode changes only
   what the next field tap records and does not reload the field.
8. A `soccer.foul` may include the committing actor's sanction when the foul and card form one
   incident. A standalone `soccer.card` represents a card without a foul or a card issued to a
   different recipient. Standalone recipients may be a player, named or unnamed coach/staff,
   or team/bench; non-player cards affect team discipline and Timeline only, never player stats.
9. Sanctions are `none`, `yellow`, `straight_red`, and `second_yellow_red`. A foul may have no
   sanction; a standalone card must have yellow, straight red, or second-yellow red. Warnings,
   temporary dismissals/blue cards, and competition-specific sanctions are deferred modules.
10. `second_yellow_red` requires an earlier active yellow for the same player in the match. It
    derives one additional yellow and one red. Removing or revising the prerequisite yellow
    preserves the raw revision history but exposes a projection diagnostic until repaired.
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

## 4. Planning Follow-up

No product-level decisions remain open from the SOC-4 Q&A. The next planning pass expands these
decisions into exact schemas, projector state, UI state diagrams, file-level delivery steps,
acceptance tests, and SOC-4A/SOC-4B/SOC-4C merge boundaries before implementation begins.
