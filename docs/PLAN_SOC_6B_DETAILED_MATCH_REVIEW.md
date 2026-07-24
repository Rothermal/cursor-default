# Plan: SOC-6B Detailed Match Review

Status: Implemented.

Parent roadmap: [PLAN_SOC_6_SUMMARY_AND_RELEASE.md](PLAN_SOC_6_SUMMARY_AND_RELEASE.md)

Depends on: [PLAN_SOC_6A_SUMMARY_FOUNDATION.md](PLAN_SOC_6A_SUMMARY_FOUNDATION.md)

## 1. Goal

Complete the soccer match-summary experience with truthful, authority-aware Players, Timeline,
Field, and conditional Shootout views.

SOC-6B builds on the SOC-6A source loader and must preserve its authority rules:

- local/current-recorder state may be editable;
- a non-final remote primary is read-only;
- a finalized game reads only its active canonical publication;
- recorder streams may be selected for review but are never blended;
- unhealthy projection data never appears as complete official totals;
- shootout activity remains separate from normal score and player totals.

SOC-6B does not publish cross-game aggregates, change soccer settings, remove production gates, or
redesign the broader application shell.

## 2. Delivery Slices

The detailed review is too broad for one implementation context. Each slice ships only complete
tabs and keeps later tabs hidden until their own acceptance boundary passes.

### SOC-6B1: Player review

Status: Implemented.

- Extend URL-backed summary tabs with `players`.
- Add the shared detailed-review read-model boundary.
- Add tracked-side player category tables and player detail sheets.
- Add read-time rates, match minutes, lineup/role intervals, DNP handling, and clean-sheet
  context.
- Add the Tracked/Opponent side selector. Until an opponent participant model contains complete
  lineup and interval data, the Opponent side uses a truthful team-only state rather than
  manufacturing player rows from labels.
- Add the optional other-recordings source control. Switching streams replaces the complete
  summary source and never changes the effective primary.

Exit condition: every tracked match participant appears with stable identity, status, role,
minutes, category totals, rates, and detail intervals for local, primary-cloud, and canonical
sources.

### SOC-6B2: Timeline review

Status: Implemented.

- Extend URL-backed summary tabs with `timeline`.
- Add oldest-first period-grouped review rows and the reviewed family filters.
- Extract reusable correction surfaces from the live tracker rather than copying mutation logic.
- Allow the owning local recorder to revise, remove, restore, and add missed events.
- Keep remote-primary, canonical, and non-owned recorder sources read-only.
- Show effective events by default, current revision metadata on demand, and removed events in a
  collapsed section.

Exit condition: the Timeline is complete and readable for every healthy source, with mutations
available only through an owned local binding.

### SOC-6B3: Field review

Status: Implemented.

- Extend URL-backed summary tabs with `field`.
- Expand field-family classification to every located SOC-3/SOC-4 normal-match event.
- Add normalized and original-orientation transforms.
- Add side, participant, family, and period filters without reloading the source.
- Add deterministic overlap clustering, marker detail, unknown-location accounting, and
  authority-aware edit entry.

Exit condition: every located normal-match event can be reviewed without hiding unlocated events
from totals or Timeline.

### SOC-6B4: Shootout review and release boundary

Status: Implemented.

- Add the conditional `shootout` tab only when a shootout actually started.
- Add round-paired attempts, retakes, forfeits, sudden death, and game-scoped kicker/goalkeeper
  summaries.
- Keep normal Players totals and rates free of shootout activity.
- Complete detailed-summary mobile polish, source transitions, automated coverage, and the SOC-6B
  manual regression matrix.

Exit condition: all four core tabs plus conditional Shootout work on mobile for local,
primary-cloud, selected-recorder, and canonical-final authority.

No Supabase migration is expected for SOC-6B. If implementation discovers a missing authorized
read contract, amend this plan before adding a database migration or direct-table query.

## 3. Shared Detailed-Review Model

Keep source loading in `summarySource.ts`, pure derivation in `src/lib/soccer`, and rendering in
focused `src/components/soccer-summary` components.

Recommended read-model boundary:

```ts
interface SoccerDetailedSummary {
  players: SoccerPlayerReview
  timeline: SoccerTimelineReview
  field: SoccerFieldReview
  shootout: SoccerShootoutReview | null
}
```

The exact implementation may derive each tab lazily, but every helper receives one
`SoccerSummarySource` or its immutable state/inspection. Components must not query tables,
re-resolve authority, or combine recorder streams.

### Source selection

- SOC-6A effective-primary and canonical selection remains unchanged.
- `Other recordings` is a secondary control, not the primary-recorder management dialog.
- Selecting another recorder loads that recorder's complete state through the existing
  authorized recorder loader and labels the summary `Other Recording`.
- A selected other recording is read-only in Summary.
- If it belongs to the current user, `Open Tracker` creates/resumes a local binding before edits
  are enabled.
- Refresh, focus polling, tab changes, and player/field filters retain the selected recorder.
- While another recording is selected, Overview and every detail tab show that recording and the
  Finalize panel is hidden. The user must return to Primary, which reloads normal
  `cloud_primary` authority, before Finalize is available.
- Finalization always uses the effective primary contract; browsing another recording never
  changes, finalizes, or appears to finalize it.
- Returning to `Primary` reloads normal `cloud_primary` authority.
- Canonical finals do not offer alternate live recorder totals as equivalent final results.
  Recorder presence/recovery remains available through the existing management control.

### URL contract

- Valid tab ids become `overview`, `players`, `timeline`, `field`, and conditionally `shootout`.
- Invalid or unavailable tabs fall back to `overview` with a replace navigation.
- `gameId`, `from`, and `teamId` remain preserved during tab changes.
- A conditional Shootout deep link falls back to Overview when no shootout projection exists.
- Filters and open detail sheets remain local UI state; they do not expand the durable route
  contract in SOC-6B.

### Diagnostics

When inspection is incomplete:

- keep the compact match header, source label, diagnostics, recorder controls, retry, Reopen, and
  Resume/Open Tracker actions;
- suppress Players, Timeline, Field, Shootout, comparison totals, leaders, and Finalize;
- retain the last good view only for transient refresh failure, following SOC-6A;
- never derive clean sheets, rates, or map markers from a partial projection.

## 4. Players View

### Navigation and layout

- Use a Tracked/Opponent segmented side control, defaulting to Tracked.
- Use category tabs: Attack, Defense, Discipline, and Goalkeeping.
- Default to Attack on every newly opened summary.
- Retain category and side changes while the current Summary remains mounted; do not persist them
  across games.
- Keep identity, lineup status, current/final role, and minutes stable while category columns
  change.
- Use prioritized columns on narrow screens and reveal the complete totals in the player detail
  sheet. Wider screens may add category columns without horizontal page overflow.
- Tapping a player row opens a mobile bottom sheet; use a centered dialog at larger breakpoints.

### Participant scope and order

- Include every participant in the immutable match setup plus valid late participants in the
  projection.
- Never merge rows by name, jersey number, or cloud player id; `participantId` is the match key.
- Order starters first in opening-lineup order.
- Order substitutes who played by first on-field appearance, then setup order.
- Order unused substitutes last in setup order and label their minutes `DNP`.
- A participant with an appearance and zero completed seconds displays `0:00`, not DNP.
- Opponent event actor labels are not a complete opponent roster. Do not infer opponent lineup,
  role, or minutes from those labels.
- The Opponent side displays player rows only when a future/compatible source provides complete
  participant records; otherwise show a team-only explanation and direct users to Overview team
  totals.

### Category columns

Use readable labels in detail and compact abbreviations only where table width requires them.

| Category | Prioritized mobile columns | Complete detail |
|---|---|---|
| Attack | Goals, assists, shots, shots on target | Own goals, primary/secondary assists, key passes, penalty and direct-free-kick attempts/goals |
| Defense | Tackles won/attempted, interceptions, clearances | Tackles lost, recoveries, blocked shots, tackle win rate |
| Discipline | Fouls committed, yellow, red | Fouls drawn and normal-match player discipline detail; never staff/team cards |
| Goalkeeping | Saves, goals allowed, save percentage | SOT faced, penalties faced/saved, clean-sheet context |

Shootout cards, kicks, goals, saves, and misses never enter these category totals.

### Rates

Derive rates at read time from raw projected totals:

| Rate | Formula |
|---|---|
| Shot accuracy | shots on target / shots |
| Goal conversion | goals / shots |
| Tackle win rate | tackles won / tackles attempted |
| Save percentage | saves / shots on target faced |

- Include regulation and extra-time penalties in ordinary shooting and goalkeeper rates.
- Exclude shootout kicks.
- Hide a rate when its denominator is zero.
- Display the percentage with its raw values, for example `67% (4/6)`.
- Keep calculations pure and unrounded until formatting.

### Minutes and intervals

- Preserve second precision in the read model.
- Display match-table minutes as `M:SS`; use `H:MM:SS` only when the elapsed value reaches one hour
  and that format improves readability.
- The player detail sheet lists on-field intervals by period and chronological start/end.
- It separately lists role intervals with role label/group and duration.
- Open intervals use the source projection's last coherent clock/end boundary.
- Same-timestamp events use canonical event ordering; a timed incident is evaluated before a
  later lineup mutation at that same elapsed time.

### Clean sheets

Team clean-sheet context is based on the corrected normal-match score:

- tracked is clean when opponent normal score is zero;
- opponent is clean when tracked normal score is zero;
- shootout score is always excluded;
- credit is final only for a completed match; non-final review may say `Currently no goals
  conceded` but does not award a clean sheet;
- suspended and abandoned matches do not award final clean-sheet credit.

Goalkeeper credit:

- require at least one on-field interval in a goalkeeper role;
- count normal and extra-time goals, including own goals, against the defending team;
- count an own goal against the goalkeeper active by canonical event order when that goalkeeper
  can be identified;
- when a conceded goal cannot be assigned to one goalkeeper but falls within one or more
  goalkeeper-role intervals, deny credit to every overlapping goalkeeper;
- when no goalkeeper interval can be identified for a conceded goal, mark individual clean-sheet
  status unavailable for that side rather than awarding every goalkeeper;
- award a keeper when no goal was conceded during any of that keeper's goalkeeper intervals;
- label every qualifying goalkeeper `Shared clean sheet` when more than one goalkeeper qualifies;
- do not require a minimum number of minutes;
- do not credit DNP goalkeepers.

Score adjustments:

- continue deriving team context from the corrected normal score;
- when an effective score adjustment makes individual concession attribution unreliable for a
  side, display goalkeeper clean-sheet status as `Unavailable - score adjusted`;
- never guess an individual goalkeeper from the adjustment timestamp;
- removing/correcting the adjustment recomputes availability deterministically.

## 5. Timeline View

### Ordering and grouping

- Sort active effective events oldest-first with the shared canonical comparator.
- Group rows under stable period headings in setup order.
- Show period-local `M:SS`, retaining second precision.
- Put untimed lifecycle events in their owning period section.
- Show shootout start and final-result context in Timeline, but keep individual shootout kicks in
  Shootout.

### Filters

Provide single-view family chips:

- All;
- Scoring;
- Attack;
- Defense;
- Restarts;
- Discipline;
- Lineup;
- Match Control.

Predicates may overlap where the event is meaningful in more than one focused view:

- Scoring contains goals, own goals, and score adjustments.
- Attack contains normal attacking events.
- Defense contains defensive actions.
- Restarts contains foul restarts, corners, offsides, and linked restart context.
- Discipline contains cards, staff cards, and sanctioned fouls.
- Lineup contains opening lineup, substitutions, role changes, participant additions, and exits.
- Match Control contains periods, clock actions, rule/direction changes, suspension, end/reopen,
  and shootout lifecycle markers.

### Corrections

- Reuse the existing checked mutation helpers and capture/correction dialogs.
- Extract shared editor orchestration from `SoccerTimeline`; do not fork validation logic into
  Summary.
- An editable local/current-recorder source may add a missed event, revise, remove, and restore.
- Remote primary, other recordings, and canonical final remain read-only.
- A cloud-owned stream without a local binding must use Open Tracker before editing.
- Failed checked mutations leave the dialog open and show the domain error.
- A successful mutation updates GameContext/local parking through the existing dispatch path and
  recomputes every summary tab from the same source.

### Revision visibility constraint

The current event stream stores the latest event envelope in place. It retains `revision`,
`updatedAt`, and `deletedAt`, but not old payload snapshots.

SOC-6B therefore:

- shows effective events by default;
- provides expandable current correction metadata for events with `revision > 1`;
- keeps removed events collapsed and discoverable;
- does not claim to show before/after payload history.

A true immutable event-revision audit ledger would require local schema, cloud schema, transport,
and finalization changes. It is deferred beyond SOC-6 unless separately planned.

## 6. Field View

### Included events

Include every normal-match event with a valid location from these families:

- attacking: shot and own goal;
- defense: tackle, interception, clearance, recovery, and blocked-shot context;
- restart/discipline: foul, card when located, corner, offside, and other located team events.

Score adjustments, lineup, clock, lifecycle, and shootout events do not produce field markers.
Unlocated events remain authoritative in totals and Timeline.

### Orientation

Default normalized mode rotates each event independently so its recorded team attacks
left-to-right. This intentionally overlays both sides in a common attacking direction for
comparison.

Original orientation:

- uses the persisted field coordinates as captured;
- respects each event's stored attacking direction and period;
- does not reinterpret old events from the current live direction;
- remains display-only and never rewrites locations.

### Filters

- Both, Tracked, or Opponent side; default Both.
- Multi-select Attack, Defense, Restarts, and Discipline families; default all.
- Participant choices scoped to the selected side.
- Include an Unknown participant bucket for team/unknown attribution.
- Full Match, Regulation, Extra Time when applicable, and individual periods.
- Filters run over the loaded read model and never trigger cloud reload.

The unknown-location count respects the active side, participant, family, and period filters.
Selecting the count opens Timeline with equivalent filters when possible and otherwise opens the
matching event list in a detail sheet.

### Markers and interaction

- Keep side color as the primary team distinction.
- Use event-specific shape/icon and outcome treatment within that color.
- Provide a visible legend for currently enabled families.
- Cluster nearby points deterministically in normalized display space.
- A cluster shows its count and opens a stable chronological event list.
- A single marker opens the shared event detail sheet.
- Editable owned local sources expose Edit from detail; all other sources remain read-only.
- Selection and hover/focus styling must not resize the pitch or markers.

## 7. Shootout View

### Visibility

- Show the Shootout tab only when `projection.shootout` exists because a shootout started.
- Keep it visible for incomplete, suspended, reopened, or abandoned shootouts.
- Do not show it merely because the rule snapshot allowed a shootout.

### Attempt presentation

- Pair tracked and opponent attempts by official round.
- Show first-kicking side, initial-round progress, score, winner/next side, and sudden-death state.
- Include kicker, goalkeeper, outcome, and official kick number when known.
- Preserve retake events beneath the advancing official attempt; visually label them
  `Retake - did not advance`.
- Clearly label forfeited attempts.
- Anonymous opponent slots remain stable labels; never merge them by display text.

### Game-scoped shootout summaries

- Kicker attempts, scores, saves against, misses, woodwork, retakes, and forfeits.
- Goalkeeper attempts faced and saves.
- Keep these values inside the Shootout view.
- Do not add them to normal score, Players categories/rates, SOC-6C season aggregates, or
  clean-sheet calculations.

Shootout correction continues through the owned local tracker workflow. SOC-6B may expose event
detail from Shootout, but it must not add a second direct cloud mutation path.

## 8. Component and File Boundaries

Expected additions:

```text
src/components/soccer-summary/
  SoccerPlayers.tsx
  SoccerPlayerTable.tsx
  SoccerPlayerDetail.tsx
  SoccerReviewTimeline.tsx
  SoccerFieldReview.tsx
  SoccerShootoutReview.tsx
src/lib/soccer/
  summaryPlayers.ts
  summaryTimeline.ts
  summaryField.ts
  summaryShootout.ts
```

Shared extraction may add focused components under `src/components/soccer/` for event detail and
correction orchestration.

Keep `SoccerSummary.tsx` responsible for route/source/action orchestration. It should not absorb
category formulas, clean-sheet logic, timeline predicates, coordinate transforms, or shootout
pairing.

## 9. Automated Verification

### SOC-6B1

- valid and invalid tab parsing/fallback;
- all setup and late participants represented once by `participantId`;
- starter/substitute/DNP ordering;
- `0:00` appearance distinguished from DNP;
- category totals and exact rate formulas;
- zero-denominator rates hidden;
- normal penalties included and shootouts excluded;
- interval formatting and same-time event ordering;
- own-goal goalkeeper attribution;
- team and individual clean-sheet states;
- shared keeper credit;
- score-adjustment unavailability;
- abandoned/non-final matches not awarded final credit;
- opponent team-only fallback;
- selecting another recorder never blends or changes effective primary.

### SOC-6B2

- oldest-first canonical ordering and period grouping;
- every event type classified into reviewed filters;
- shootout kicks excluded while lifecycle context remains;
- effective/removed event presentation;
- current revision metadata without false historical payloads;
- local owned add/edit/remove/restore;
- remote/canonical/other-recorder mutation controls absent;
- checked mutation failure preserves prior state.

### SOC-6B3

- all located event families included;
- unlocated events omitted only from markers;
- normalized transformation for both attacking directions;
- original orientation preserves stored coordinates;
- combined side/participant/family/period filtering;
- regulation and extra-time aggregate periods;
- deterministic clustering independent of input order;
- filter-aware unknown count with equivalent Timeline handoff when representable, otherwise the
  matching detail-list fallback;
- marker detail and edit authorization.

### SOC-6B4

- conditional tab visibility;
- normal rounds, early decision, and sudden death pairing;
- retakes do not advance attempt numbering;
- forfeits remain visible;
- anonymous opponent slots remain distinct;
- shootout participant summaries;
- shootout values excluded from normal player rates, score, and clean sheets;
- URL tab retention through refresh, Finalize, and Reopen;
- diagnostics suppress all detailed views and keep recovery actions;
- basketball `/summary` remains unchanged.

## 10. Manual Regression

Extend `docs/REGRESSION_TESTING.md` incrementally with each slice, then run the complete SOC-6B
matrix:

1. Review local-only, bound current-recorder, remote primary, selected other recorder, and
   canonical-final sources.
2. Confirm switching tabs and filters never changes the active or parked game.
3. Verify all participant ordering, DNP, intervals, rates, and clean-sheet edge cases.
4. Exercise Timeline filters and local revision/add/remove/restore flows.
5. Confirm remote and canonical sources remain read-only.
6. Verify every located event family, both orientation modes, clusters, and unlocated counts.
7. Review regulation, extra time, shootout, retake, sudden-death, abandoned, and score-adjusted
   fixtures.
8. Force projection diagnostics and transient refresh failure.
9. Verify sticky horizontal tabs, tables, sheets, pitch, and long names at narrow mobile and
   desktop widths.
10. Re-run basketball local and cloud Summary routes.

## 11. Reviewed Decisions

The SOC-6B Q&A selected the recommended option for all 32 questions:

- canonical event order resolves same-timestamp goal/substitution boundaries;
- own goals count against the defending team and identifiable active goalkeeper;
- score adjustments retain team context but suppress unreliable individual keeper attribution;
- shootout events stay outside normal rates and clean sheets;
- Tracked/Opponent segmented player review with a truthful opponent team-only fallback;
- Attack default category, session-local category state, lineup-aware ordering, and detail sheet;
- prioritized mobile columns with complete detail totals;
- rates show percentage plus raw values and use reviewed numerator/denominator formulas;
- normal/extra-time penalties count in rates while shootouts do not;
- focused Timeline families, shootout lifecycle context only, effective-event default, and owned
  local add/edit;
- per-side normalized field direction, all families visible by default, deterministic clusters,
  and event detail;
- multi-family field filters, scoped participants, aggregate/individual period filters, and
  actionable unknown-location counts;
- Shootout appears when started and uses paired rounds, visible retakes/forfeits, and game-scoped
  participant summaries;
- other recorder streams are optional, clearly labeled, and never blended;
- owned cloud streams open locally before editing;
- diagnostics suppress derived detail while preserving recovery;
- sticky URL-backed mobile tabs.

## 12. Deferred

- Immutable before/after event revision audit storage.
- Full opponent lineup, substitutions, roles, and minutes capture.
- Cross-game soccer aggregates and canonical stat ids: SOC-6C.
- Account/team/match soccer defaults: SOC-6D.
- Production availability and full release hardening: SOC-6E.
- Broader application reskin.
