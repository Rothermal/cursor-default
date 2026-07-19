# Plan: SOC-3 Field and Attacking Events

Detailed implementation plan for soccer field capture, attacking events, score projection,
and correction history. SOC-3 builds on the event-backed match state from SOC-2 and is split
into three sequential pull requests so the domain contract lands before the live capture UI.

Status: Complete. SOC-3A, SOC-3B, and SOC-3C are implemented.

---

## 1. Goal

Support the core attacking game locally from field tap through corrected match history. A
recorder must be able to capture shots, goals, saves, blocks, creators, own goals, and score
adjustments for either side while score and player/team totals remain fully derived from the
event stream.

SOC-3 remains development-only and local-only. Defensive events, discipline, staff cards,
corners, offsides, shootouts, cloud event sync, summaries, season aggregation, and release
belong to SOC-4 through SOC-6.

---

## 2. Delivery Slices

### SOC-3A: Attacking event domain (complete)

- Add production schemas for shots, own goals, and explicit score adjustments.
- Preserve stable match-participant identity in event actors so resolving an anonymous
  participant never rewrites prior events.
- Add semantic validation for actor roles, outcome/context combinations, location,
  period/time, lineup participation, and goalkeeper links.
- Project score, side totals, player attacking totals, and goalkeeper totals from events.
- Keep score adjustments separate from shot and player statistics and reject negative score.
- Add focused schema, projection, revision, deletion, and malformed-history tests.
- Do not expose unfinished field capture controls in this slice.

### SOC-3B: Live field and capture (complete)

- Add the full-field live surface with a fixed recorder viewpoint and period attack arrows.
- Add a display-only Flip Field View control that mirrors locations without rewriting them.
- Add explicit Tracked/Opponent capture side selection and a compact tracked-player selector.
- Add one compact shot sheet for outcome, shooter, situation, creators, goalkeeper, and blocker.
- Add side-aware defaults, unknown/team attribution, and recent opponent labels.
- Add event-driven score controls and quick unknown-location Goal actions for either side.
- Persist the latest eligible tracked-player and capture-side choices with the parked game.

### SOC-3C: Timeline, correction, and field review (complete)

- Replace soccer History with one newest-first Timeline for match-control and attacking events.
- Add All, Attacking, and Match Control filters with removed events collapsed by default.
- Show current-period shot markers by default, with side and full-match filters.
- Open the same event editor from a field marker or timeline row.
- Support revisioned edits, removal/restoration, goalkeeper-link correction, and historical add.
- Allow historical attacking events in a selected period/time while preserving lineup diagnostics.
- Add scoring-timeline access from the score and explicit signed score corrections with reasons.
- Complete mobile, parking/resume, correction, and regression coverage.

SOC-3A, SOC-3B, and SOC-3C were delivered sequentially. SOC-4 is the next soccer phase.

---

## 3. Event Model

### Shot

`soccer.shot` is the single attacking attempt event for both sides.

```text
teamSide: tracked | opponent
location: normalized point or null
payload:
  outcome: goal | saved | blocked | off_target | woodwork
  situation: open_play | penalty | direct_free_kick | corner_sequence | other_set_piece
actors:
  shooter                 exactly one player/unknown/team actor
  creator_primary         optional; tracked participant for tracked-side events
  creator_secondary       optional; goal only and requires a primary creator
  goalkeeper              optional or required by side-aware rules
  blocker                 blocked shots only; optional or required by side-aware rules
```

The event side is the shooting side. `goal`, `saved`, and `woodwork` are shots on target only
where explicitly defined below: goal and saved count as on target; blocked, off target, and
woodwork do not. Woodwork remains a distinct outcome rather than being inferred as on target.

Situation is independent from attribution. Penalty and direct-free-kick situations derive
their attempt/goal splits but do not create foul, penalty-won, free-kick, or restart events.
A corner-sequence shot does not create a corner event.

### Own goal

`soccer.own_goal` is separate because an own goal changes score without creating a shot.
`teamSide` is the benefiting side and `own_goal_by` belongs to the opposite side. Location is
the decisive own-goal touch when known. An opponent-benefiting own goal links the tracked
on-field goalkeeper for goals allowed, but does not add a shot or shot on target faced.

### Score adjustment

`soccer.score_adjustment` contains a signed `+1` or `-1` delta and a required reason.
`teamSide` identifies the adjusted side. It changes score only, does not invent a player or
attempt, and is rejected when it would make that side's projected score negative.

### Revisions and deletion

All three event types use the shared revision lineage. Editing replaces the active revision;
removal excludes the event from score and every derived total; restoration reprojects it.
Capture sequence remains the deterministic event order even when a later UI adds a historical
period/time.

---

## 4. Identity and Attribution

Tracked actors reference the stable soccer match `participantId`. A resolved roster player may
also carry `playerId` as a convenience, but `participantId` remains authoritative. Anonymous
participants therefore retain their event history when SOC-2 participant resolution later maps
them to a player.

Live tracked-player choices are limited to on-field participants. Historical capture and edits
may select any match participant, but the projector verifies that participant was on field at
the event's period and elapsed time. An invalid correction is preserved with a semantic
diagnostic until the attacking event or lineup history is repaired. Team attribution remains an
explicit fallback when no individual should receive credit.

The opponent does not gain a full roster in SOC-3. Opponent actors use event-local unknown or
labeled identities. Recent labels may improve capture speed but do not become durable roster
records or receive tracked-player aggregates. Opponent creator labels are allowed as symmetric
event context, but they do not project tracked-player assist or chance totals.

Creator rules are:

- a non-goal shot may have one primary creator, projected as a key pass;
- a goal may have one primary assist and one optional secondary assist;
- a secondary creator requires a primary creator;
- penalty, direct-free-kick, and own goals cannot receive creators; and
- the shooter cannot also be a creator.

---

## 5. Field and Capture Behavior

The field remains fixed to the recorder's physical viewpoint. The tracked side's authoritative
attack direction comes from the active SOC-2 period. Every located event stores normalized
coordinates plus its capture-time attacking direction. Flip Field View mirrors display and tap
coordinates only; it never mutates persisted events.

The live field uses an explicit Tracked/Opponent segmented control. The selected side persists
until changed. Tracked capture defaults to the selected on-field participant; that selection
persists across park/resume and clears when the participant leaves the field. Opponent capture
defaults to unknown and may reuse recent event-local labels.

A field tap opens one compact shot sheet. It keeps outcome, shooter, situation, and relevant
linked actors together and saves one event. Penalties default to the penalty mark but can be
moved or cleared. Every flow provides Location unknown; no zone snapping is stored.

The field displays outcome markers for both sides in the current period by default. Filters can
show one side or the full match. Side color and outcome shape carry meaning; removed events
disappear. Selecting a marker opens the same editor used by the Timeline.

---

## 6. Score and Projection Rules

The score is event-derived. Normal goal shots, own goals, and explicit score adjustments are the
only SOC-3 score sources. Quick Goal actions still create a normal goal event with unknown
location and team/unknown attribution. Tapping the score opens scoring history; there are no raw
score increment/decrement buttons.

Shot outcome projection is:

| Outcome | Shot | Shot on target | Score | Outcome total |
|---|---:|---:|---:|---:|
| Goal | 1 | 1 | +1 | goal +1 |
| Saved | 1 | 1 | 0 | saved +1 |
| Blocked | 1 | 0 | 0 | blocked +1 |
| Off target | 1 | 0 | 0 | off-target +1 |
| Woodwork | 1 | 0 | 0 | woodwork +1 |

An attributed goal also adds a player goal. An unattributed team goal adds the side's score,
shot, and shot on target without adding a player goal.

For opponent shots, saved attempts link the tracked on-field goalkeeper and add save plus shot
on target faced. Opponent goals add goal allowed plus shot on target faced. Opponent own goals
benefiting the tracked team do not affect the tracked goalkeeper. Tracked-player own goals
benefiting the opponent add a goal allowed to the tracked on-field goalkeeper without adding a
shot on target faced. Penalty saves/goals additionally derive penalty faced and penalty save as
applicable.

SOC-3 projects these player compatibility totals:

- `soc_goal`, `soc_own_goal`
- `soc_ast_primary`, `soc_ast_secondary`, `soc_ast`
- `soc_shot`, `soc_sot`
- `soc_key_pass`, `soc_chance_created`
- `soc_pen_att`, `soc_pen_goal`
- `soc_dfk_att`, `soc_dfk_goal`
- `soc_gk_save`, `soc_gk_ga`, `soc_gk_sot_faced`
- `soc_gk_pen_faced`, `soc_gk_pen_save`

Chance created equals key passes plus primary assists. Secondary assists do not add a chance.
Save percentage remains derived from saves and goals allowed rather than stored as an event.

The soccer projection also keeps side totals for score, shots, shots on target, each shot
outcome, penalties, and direct free kicks. These sport-owned totals are the summary source of
truth; legacy `GameState` score fields are compatibility projections only.

---

## 7. Timeline and Historical Capture

The soccer Timeline combines match-control, lineup, role, attacking, own-goal, and score events.
It is newest first and offers All, Attacking, and Match Control filters. Removed history is
preserved but collapsed until requested.

Live field capture is allowed only in an active period, whether the clock is running or paused.
A stopped-clock indicator is sufficient; repeated confirmation is not required. Period breaks
and ended matches are review-only on the field.

Timeline Add missed event selects an eligible period and `MM:SS` time and uses the same semantic
validation as live capture. Historical attacking events do not rewind or advance the live clock.
Lineup participation is evaluated against reconstructed period/time intervals, so a late-added
event can be valid even when its capture sequence follows match end. The projection records every
started period and its latest end elapsed time explicitly, including a period closed by suspension
or abandonment, rather than inferring historical eligibility from participant intervals.

---

## 8. Side-Aware Defaults

- Tracked shot: selected on-field participant; unknown opponent goalkeeper/blocker allowed.
- Opponent shot: unknown opponent shooter; tracked goalkeeper defaults when required.
- Opponent saved shot: tracked on-field goalkeeper is required.
- Opponent blocked shot: tracked on-field blocker or explicit team/unknown attribution.
- Tracked blocked shot: opponent blocker is optional and remains event-local.
- Opponent goal: tracked on-field goalkeeper is required for goals allowed.
- Tracked own goal: event benefits Opponent and names the tracked participant plus tracked
  goalkeeper.
- Opponent own goal: event benefits Tracked and may carry an opponent label; no tracked
  goalkeeper statistic is added.

All defaults remain editable before save. Corrections use the same constraints.

---

## 9. Validation and Testing

SOC-3 requires coverage for:

- every outcome, situation, and legal actor-role combination;
- malformed payloads, locations, duplicate roles, and impossible creator combinations;
- stable participant attribution before and after anonymous resolution;
- participant on-field checks at event period/time;
- tracked and opponent score/stat symmetry;
- goalkeeper saves, goals allowed, shots on target faced, and own-goal differences;
- team-attributed and unknown-attributed attempts;
- score adjustments, including negative-score rejection;
- edits, removals, restoration, diagnostics, and atomic rollback;
- fixed-view coordinate transforms and attacking-direction persistence;
- park/resume defaults, live capture eligibility, and historical add; and
- basketball and shared event-foundation regressions.

Before each slice merges, run `pnpm test`, `pnpm lint`, and `pnpm build`. SOC-3B and SOC-3C also
require mobile and desktop interaction checks through the real HashRouter routes.

---

## 10. Deferred Work

SOC-4 owns defensive actions, discipline, coach/staff cards, corners, offsides, shootouts, and
final match outcomes. Detailed goal buildup, possession, expected goals, zone aggregates, and a
durable opponent roster remain optional later additions. SOC-5 owns cloud event synchronization
and finalization. SOC-6 owns summaries, season aggregation, settings, migration/release gates,
and removal of soccer's development-only guard.

Basketball still uses its legacy stat/action model. A separate basketball event-model redesign
plan tracks future migration to the shared event architecture; SOC-3 must not partially migrate
basketball while adding soccer events.
