# Plan: HKY-2 Rink Surface and Core Capture

Execution plan for the second hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on the HKY-1 foundation
([plan and delivery record](PLAN_HKY_1_FOUNDATION_RULES_AND_ROSTER.md)): rules, setup,
the sport state, the lifecycle and clock events, and the development-only preview.

Status: approved for implementation. The owner answered every §7 question on 2026-09-27.
HKY-2A is implemented; see §8.

---

## 1. Goal

HKY-2 exits when a local hockey event game can be tracked end-to-end on the rink:

- a rink drawing with per-period attacking direction, a display-only flip, and zones,
- shots and goals with assists, the defending goalie, blocked-shot blockers, and optional
  on-ice skaters at each goal,
- the goalie in net for both sides, goalie changes, a pulled goalie and empty-net goals,
- faceoffs in two taps, hits, takeaways, giveaways,
- signed, reasoned score adjustments,
- a live score, shots by side and period, and per-player totals,
- Recent Events with newest-only Undo on the rink,
- the owner can try it on a phone through a default-off production toggle (§7 Q2).

Not in HKY-2: penalties and strength (HKY-3A/3B), timeouts and icing/offside (HKY-3B),
shootout and structured outcomes (HKY-3C), Timeline edit/remove/restore and
recorded-later additions (HKY-4), cloud (HKY-5), Summary and aggregates (HKY-6), team line
defaults (moved to HKY-5C/6C, §7 Q3).

---

## 2. Slices

### HKY-2A Rink geometry and component

Files: `src/lib/hockey/rinkGeometry.ts`, `src/components/hockey/HockeyRink.tsx`, and a
shared surface-location helper (XS-5).

- **XS-5 extraction.** Hockey is the second consumer of Soccer's
  `soccerFieldLocation(displayX, displayY, flipped, attackingDirection)`. Move the body to
  `src/lib/surface/location.ts` as `surfaceLocation`. Keep `soccerFieldLocation` as a
  one-line wrapper so no Soccer caller or test changes. Football reuses the same helper
  later. The marker clustering in `soccer/field.ts` moves only when the hockey marker
  layer needs it, in HKY-4.
- **Geometry**, normalized from a 200 x 85 ft reference rink (HKY-0 §4):
  - goal lines at x = 0.055 and 0.945, blue lines at 0.375 and 0.625, center line 0.5,
  - nine faceoff dots with stable ids in the canonical (unflipped) frame:
    - `center`,
    - `left_end_upper`, `left_end_lower`,
    - `left_neutral_upper`, `left_neutral_lower`,
    - `right_neutral_upper`, `right_neutral_lower`,
    - `right_end_upper`, `right_end_lower`,
  - end-zone dots 20 ft out from the goal line and neutral dots 5 ft from the blue line,
    each 22 ft either side of the long axis.
- **Helpers:**
  - `hockeyRinkLocation` wraps `surfaceLocation`,
  - `nearestHockeyFaceoffDot(location)` returns the dot id and its exact canonical point,
  - `hockeyZone(location, side, trackedAttackingDirection)` returns offensive, neutral or
    defensive for that side, derived at read time and never stored.
- **Component:**
  - SVG boards with 28 ft corners, goal and blue lines, center line, creases and nets,
    all nine dots and circles, and the trapezoid when `rules.trapezoid` is true,
  - an attack-direction arrow for the tracked team,
  - markers passed in as props, and a tap callback in display coordinates,
  - the flip reads `capturePreferences.rinkFlipped` and never changes stored coordinates.
- **Phone layout (Q1):** the rink is always horizontal, as Soccer's pitch is. It spans
  the full width and stays on screen above the quick row. Faceoff snapping and dialog
  confirmation make up for the short height in portrait.

Tests:
- geometry constants,
- dot snapping from every quadrant, ties broken by dot id order,
- zone derivation for both directions and both sides,
- display-to-canonical round trips with the flip on and off,
- `soccerFieldLocation` output unchanged after the extraction.

### HKY-2B Shots, goals, goalies, score adjustments

Files: `src/lib/hockey/captureEvents.ts`, `captureProjection.ts`, `stats.ts`,
`captureCommands.ts`, `src/components/hockey/HockeyShotDialog.tsx`,
`HockeyGoalieDialog.tsx`.

**Events** (all `schemaVersion: 1`; the capture side is the envelope `teamSide`):

- **`hockey.shot`**, side `tracked | opponent` (the shooting side):
  - `outcome`: `goal | saved | missed | blocked`,
  - `missType`: `wide | high | post | crossbar`, or null; only a missed shot may set it,
  - `emptyNet`: boolean. It is prefilled from the projected goalie in net and stored as
    confirmed, so a later goalie correction never silently changes it,
  - `penaltyShot`: boolean,
  - `strength`: `ev | pp | sh`, or null. The field is frozen now so HKY-3B does not need
    schema version 2. HKY-2 always writes null, and HKY-3B adds prefill and confirmation,
  - `onIce`, for goals only, the tracked side's players (see the on-ice prompt below):
    - `status`: `complete | partial | not_recorded`,
    - `skaterParticipantIds`: skaters only,
    - `goalie`: a participant id, `'empty_net'`, or null when unknown,
  - `captureCommandId`,
  - actors:
    - `shooter` (optional; absent means Team, unattributed; this also covers a goal
      credited to no one, since hockey has no own-goal event),
    - `assist_primary` and `assist_secondary`, goals only and only when a shooter exists,
    - `goalie`, the defending goalie stamped at capture,
    - `blocker`, blocked shots only, from the defending side,
  - location: optional canonical rink point.
- **`hockey.goalie_change`**, side `tracked | opponent`:
  - `inParticipantId`: the participant or opponent goalie id; null leaves the net empty,
  - `reason`: `tactical | injury | pulled | return | penalty`,
  - `newOpponentGoalie`: `{ id, label, number }` or null. It adds an opponent goalie
    identity the first time one is used, following Baseball's opponent pitchers.
- **`hockey.score_adjustment`**, side `tracked | opponent`: `{ captureCommandId, delta: 1 | -1, reason }`.
  The reason is required, following Soccer and Basketball.

**Replay additions** to the HKY-1 projector:

- **Capture guards.** Capture events need `status: 'in_progress'` and an active period.
  Their `elapsedMs` follows the existing anchored-clock rule unchanged.
- **Actor sides.** A tracked actor must be a dressed participant of the right kind:
  shooters, assisters and blockers are skaters, goalies are goalies. An opponent actor is
  a label actor. Assisters must differ from the shooter and from each other. The blocker
  must be on the defending side.
- **Goalie in net per side.**
  - It starts from the opening lineup (tracked) and `setup.opponentGoalie` (opponent).
  - Goalie changes update it. Pulling the goalie sets null, and a later change puts a
    goalie back.
  - Goalie intervals record the period and elapsed at each change; TOI is derived only
    for anchored games.
- **Stamped goalie.** A shot's stamped goalie actor is checked against the projected
  goalie. A mismatch is a warning, not a replay failure, following Baseball's
  `actor_mismatch`, because HKY-4 corrections may legitimately edit the goalie.
- **Score** is goals plus adjustments. Adjustments never create player goals. A negative
  side score rejects the event.
- **Sudden-death overtime (Q4), only when the rules say so.**
  - Rules v1 gains `overtime.suddenDeath: boolean`. It is added to v1 rather than
    starting v2 because the old shape stays readable (below). Every built-in profile
    sets it to true, and a Custom or match override can turn it off.
  - With `suddenDeath: true`, a goal in an overtime period sets `decidedInPeriodId`.
  - Replay then accepts only `clock_paused`, `period_ended`, `match_ended`, suspend,
    abandon, reopen and score adjustments.
  - The UI offers one-tap End game.
  - With `suddenDeath: false`, the overtime period plays to its full length and the
    usual period end and tie logic applies.
  - The existing between-periods logic already reads the real score, so an untied
    regulation ends without overtime.
- **Reading pre-HKY-2 rules (compatibility contract).** HKY-1 snapshots store an
  overtime object with exactly `lengthMs`, `skaters`, `repeat` and `endsPolicy`, and
  local HKY-1 games (NHL, high-school and NCAA profiles) must keep loading.
  - `validateHockeyMatchRules` accepts exactly two overtime key sets: the HKY-1 four
    keys, or those four plus `suddenDeath` (a boolean). Any other key, a missing key, or
    a non-boolean `suddenDeath` is still rejected, so unknown-key rejection is kept.
  - Reads never rewrite. `normalizeHockeyMatchRules` returns the stored shape as-is, so
    hydration, parking, export and import keep the four-key snapshot byte-for-byte and
    the game fingerprint does not change. Setup is immutable once the stream exists, so
    nothing later adds the key to an old game either.
  - Behavior comes from one accessor, `hockeyOvertimeSuddenDeath(rules)`. It returns the
    stored boolean, or true for the four-key shape. True is the implied HKY-1 behavior:
    every HKY-1 profile was designed as sudden death, and HKY-1 had no goal events, so
    no old game can replay differently. The projector and commands read only the
    accessor, never the raw field.
  - New writes are always five keys: profiles, the settings hierarchy (overrides replace
    the whole `overtime` field, so a stored four-key override is resolved through the
    same reader) and setup commits.
  - No database migration is needed; this is a local snapshot contract.
  - Tests use literal pre-HKY-2 fixtures checked into `src/lib/hockey/fixtures/`, a
    four-key NHL game and a four-key high-school game with lifecycle and clock events,
    written out by hand rather than built with the profile constructor, so a profile
    change cannot silently regenerate them. They cover hydration, park and resume,
    parked import, an unchanged fingerprint, and sudden-death behavior in overtime.
    A snapshot with a sixth overtime key, and one with a string `suddenDeath`, are
    rejected.
- **Stats.** Per-period score and shots on goal come from the same replay. The projector
  fills `playerStatsById` from a new `hky_*` catalog in `stats.ts`:

  | Group | Stats |
  |---|---|
  | Skaters | `hky_g`, `hky_a`, `hky_a1`, `hky_a2`, `hky_pts`, `hky_sog`, `hky_sat` (attempts), `hky_miss`, `hky_blocked_by` (own attempts blocked), `hky_blk` |
  | Goalies | `hky_ga`, `hky_sa`, `hky_sv` |
  | Plus/minus | `hky_pm`, which waits for strength (Q5) |

  The ids are final so HKY-6 aggregates reuse them.

**Commands** go through `live.ts`'s existing `command` helper. It does a fresh replay,
checks the registry, runs a candidate replay and appends atomically.

- `recordHockeyShot(state, input, context)` stamps the defending goalie and the
  empty-net prefill from the fresh projection.
- `changeHockeyGoalie` and `pullHockeyGoalie` record goalie changes.
- `adjustHockeyScore` records a score adjustment.
- The recorder can override the empty-net value.

**Actor eligibility without shift tracking** (HKY-0 §9) is the acceptance gate for HKY-2B:

- A skater picker offers every dressed skater of the tracked side, sorted by
  `sortHockeyActors`. The opening five never narrows it.
- A goalie picker offers dressed goalies only.
- Opponent actors are label entries with a match-scoped recent-label chip row (Q6). The
  opponent goalie picker lists the known opponent goalies plus Add.
- HKY-3 later removes game-misconduct players from pickers. HKY-2 has no removal rule.
- Tests assert that a skater who did not start is selectable for every skater role, and
  that no picker reads `openingLineup` after period 1 starts.

**Goal on-ice prompt (Q4 in HKY-0):**

- The goal dialog shows an optional on-ice section for the tracked side. Skaters are a
  multi-select; the goalie is one choice of a dressed goalie or **Net empty**.
- It is prefilled from the previous goal's set, or from the opening lineup for the
  first goal of the game. The goalie choice is prefilled from the projected tracked
  goalie in net. The prefill is labelled as a guess.
- The status is set by the recorder, not by counting against a regulation number,
  because the right number changes with reduced-skater overtime (the NHL profile has 5
  in regulation and 3 in overtime), a pulled goalie, and later penalties.
  - `not_recorded`: the section was left untouched. Nothing is stored.
  - `complete`: the recorder ticked **This is everyone on the ice**. The command
    accepts it only when the set is structurally possible: no duplicates, every id a
    dressed tracked participant, skaters at least `minimumSkaters`, and at most the
    period's skater count (`skaters` from overtime settings in an overtime period,
    otherwise `skatersPerSide`) with a goalie in net, or one more than that when the
    net is empty. The goalie choice must be made.
  - `partial`: anything else the recorder entered without that tick, including an
    unknown goalie. It has no count rules beyond no duplicates and dressed participants.
- An empty net is a recorded fact, not missing data. The payload keeps it apart from an
  unknown goalie:
  - `onIce.skaterParticipantIds`: the skaters,
  - `onIce.goalie`: a goalie participant id, `'empty_net'`, or null when unknown. A
    `complete` set never has null.
- The skater bound above is only a sanity check. Penalties are not modelled until
  HKY-3, so a short-handed complete set (for example 4 skaters and a goalie in
  regulation) is accepted as long as it is at least `minimumSkaters`.
- Future strength handling (HKY-3B) never rewrites a saved status. It may add an
  advisory diagnostic when a complete set disagrees with the projected manpower, and
  plus/minus (HKY-3B) counts only complete sets. A saved goal is never reclassified
  retroactively.
- Tests cover:
  - a regulation 5 skaters plus goalie complete set,
  - an NHL overtime 3 skaters plus goalie complete set,
  - goalie pulled: 6 skaters with an empty net is complete, and the next goal after
    the goalie returns prefills the goalie again,
  - a genuinely partial set (3 skaters, goalie unknown, no tick),
  - `complete` rejected for 2 skaters, for 7 skaters with a goalie, for a duplicate,
    for a non-dressed id and for a null goalie,
  - an untouched section stored as `not_recorded`.

Tests:
- every outcome's derived counts, assists rules, blocker side,
- stamped goalie and empty-net prefill, and a pulled goalie followed by an empty-net goal,
- opponent goalie introduction,
- a score adjustment that would go negative is rejected,
- overtime with sudden death on and off, both clock models, and valid-prefix replay
  after a bad event,
- actor eligibility,
- setup-only fingerprints.

### HKY-2C Faceoffs, physical events, Recent Events and Undo

Files: `captureEvents.ts`, `captureProjection.ts`, `captureCommands.ts`,
`recentEvents.ts`, `src/components/hockey/HockeyFaceoffControl.tsx`,
`HockeyRecentEvents.tsx`.

**Events:**

- **`hockey.faceoff`**, side `neutral`:
  - `{ captureCommandId, dotId, winner: 'tracked' | 'opponent' }`,
  - the location must equal the snapped dot point exactly,
  - actors: `taker` (optional tracked skater) and `opponent_taker` (optional label).
- **`hockey.hit`**, side = the hitter's side: actors `hitter` and optional `hit_player`
  (other side); optional location.
- **`hockey.takeaway`** and **`hockey.giveaway`**, side = the actor's side: one optional
  `player` actor; optional location.

**Faceoff flow (two taps):**

1. The recorder taps near a dot, and the rink highlights the snapped dot.
2. Won and Lost buttons appear with the tracked taker preselected. The default is the last
   tracked faceoff taker, or the first dressed C if there is none (HKY-0 Q7). A chip
   changes the taker without an extra dialog.

The projection keeps `lastTrackedFaceoffTakerId`. Faceoff counts per player and team,
and by zone, derive from the dot and the period direction:

| Stat | Id |
|---|---|
| Faceoffs won / lost | `hky_fow`, `hky_fol` |
| Hits | `hky_hit` |
| Takeaways | `hky_tk` |
| Giveaways | `hky_gv` |

**Tap-rink chooser:** Shot, Faceoff, Hit, Takeaway, Giveaway. Shot opens the shot dialog
at the tapped point; Faceoff snaps.

**Quick row without a location:**
- Goal, Shot, Goalie and Score adj. in HKY-2,
- the HKY-0 §9 entries Penalty, Timeout and Icing/Offside arrive in HKY-3.

**Recent Events and Undo** (Soccer S4 and Basketball F12 lesson):

- The list shows the last ten active user-recorded capture units, newest first. A unit
  is the events sharing a `captureCommandId`, or a single event.
- Lifecycle and clock rows are shown for context but cannot be undone.
- Undo removes only the newest unit. It is offered only when no later active event
  exists, lifecycle included, so nothing can depend on it.
- Undo soft-deletes through `applyGameEventAppendsAndMutations` delete mutations, and
  the candidate must replay completely.
- One reload-safe restore receipt, which stays out of fingerprints, lets the recorder
  Restore the unit they just undid until the next capture. This is Basketball's
  `courtCorrections` receipt rule.
- Full edit, remove and restore of any event is HKY-4.

Tests:
- dot/location agreement and the taker default chain,
- faceoff counts by zone,
- hit sides,
- undo of each family, and undo refused behind a lifecycle event,
- restore receipt lifecycle across reload,
- capture-unit grouping.

### HKY-2D Team default lines (moved to HKY-5C/6C, Q3)

HKY-0 placed team lines (F1-F4, D1-D3) and a Team Manage Lines tab here. No hockey team
settings can be saved until the hockey settings migration in HKY-5C, and nothing in
HKY-2 to HKY-4 reads lines, so the lines shape, settings storage and the Team Manage tab
land together in HKY-5C/6C.

### HKY-2E Owner tracker and setup (Q2)

Files: `src/pages/HockeyGameSetup.tsx`, `src/pages/HockeyGameTracker.tsx` (replacing the
HKY-1 `HockeyEventPreview` live panel), `src/lib/sportAvailability.ts`.

- **Tracker layout, top to bottom on a phone:**
  - scoreboard strip: score, period, clock with Start/Pause, shots on goal by side,
  - the rink, kept on screen,
  - the quick row,
  - Recent Events.
  - Period and match controls stay in a menu, following Basketball BKE-6B3.
- **Setup:**
  - opponent, rules profile with match overrides for period length and clock model,
  - period 1 attacking direction on the rink drawing,
  - roster: a read-only cloud team roster when a team is chosen, or quick local entries,
  - dressed-as per participant, the opening goalie, and the opening skaters picked by
    the recorder (no team defaults exist yet).
- **Release stage (Q2, approved):** production gets a per-sport `hockeyEvent` stage in
  `sportAvailability.ts`. This is the first step of XS-1. It is `opt_in` with a device
  toggle defaulting off, like Basketball BKE-5D, and local-only: event hockey still has
  no cloud route. Development keeps the preview without the toggle.
  - The HKY-1 gate test becomes the audited consumer list for the new policy.
  - The not-available notice stays for builds with the toggle off.

---

## 3. Data and compatibility rules

- No migration. Everything stays local, and event hockey keeps reaching no cloud route.
- No change to setup v1. Rules v1 gains only `overtime.suddenDeath` (Q4). The HKY-1
  four-key overtime shape stays readable, is never rewritten, and behaves as sudden
  death (see the compatibility contract in HKY-2B). HKY-2 otherwise adds event types, and
  every payload field that later phases need (strength, on-ice) is present from the
  start as nullable.
- Games created in HKY-1 load and replay unchanged, with the same fingerprint: their
  rules keep the four-key overtime shape and they contain only lifecycle and clock
  events. Literal pre-HKY-2 fixtures prove it.
- Legacy hockey stat-grid games, Soccer and Basketball are untouched.
- Every accepted command still round-trips through `HYDRATE_STATE`, the HKY-1 review
  lesson.

---

## 4. Cross-sport items touched

| Id | In HKY-2 |
|---|---|
| XS-1 | First per-sport stage entry (`hockeyEvent`, Q2); the table shape is kept small enough for Football and Baseball to add rows |
| XS-5 | `surfaceLocation` extracted from Soccer with a wrapper; Football can reuse it |
| XS-6 | Not extracted. HKY-1 wrote a small hockey clock projection rather than importing Basketball's; both now exist, and the extraction stays deferred until Football needs a third |
| XS-8 | A match-scoped recent opponent labels row only; no shared opponent identity model |

---

## 5. Regression

`docs/REGRESSION_HKY_2_CORE_CAPTURE.md` when implementation lands:

- a full local game on a phone: faceoffs, shots, a goal with assists and on-ice,
  a goalie pull and empty-net goal, a score adjustment, Undo and Restore,
  reload mid-period with the clock running,
- both clock models, and both initial directions with the flip on and off,
  checking that stored coordinates are identical,
- an overtime goal ending the game under sudden death, a full-length overtime without it,
  and an untied regulation ending without overtime,
- HKY-1 games still load, legacy hockey games are unchanged, and Soccer and Basketball
  event games park together with hockey,
- the production toggle is off by default, and with it off the setup route
  shows the notice,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 6. Corrections to the HKY-1 record

- The HKY-1 delivery record and a projector comment say a forbidden tie waits for the
  "HKY-4 shootout". HKY-0 §12 puts the shootout in HKY-3C. This PR corrects both.

---

## 7. Owner Decisions (2026-09-27)

| # | Question | Decision |
|---|---|---|
| Q1 | Rink orientation on a phone held upright? | Horizontal, like Soccer (the owner's choice over the vertical recommendation) |
| Q2 | Let the owner try hockey on a phone before the full release? | Yes: an owner-only, default-off device toggle in production at the end of HKY-2, local-only with no cloud |
| Q3 | Move team default lines out of HKY-2? | Yes, to HKY-5C/6C with settings storage |
| Q4 | What happens after an overtime goal? | Only when the rules use sudden death: further play is blocked and one tap ends the game, with no automatic ending so a mistaken goal can be undone. Adds `overtime.suddenDeath` to rules v1 |
| Q5 | Plus/minus before strength exists? | Yes: capture on-ice sets now, show plus/minus from HKY-3B |
| Q6 | Opponent shooters and goalies? | Yes: jersey or name labels with chips for labels used this game |
| Q7 | Must shots be placed on the rink? | No: rink taps store a location, and quick Shot and Goal buttons record without one |

---

## 8. Delivery record

### HKY-2A (implemented)

- `src/lib/surface/location.ts` holds `surfaceLocation`; `soccerFieldLocation` is a
  one-line wrapper, and `src/lib/surface/location.test.ts` compares it with the
  pre-extraction formula across a grid of taps, both flips and both directions.
- `src/lib/hockey/rinkGeometry.ts` holds the normalized lines, the nine dots in
  `HOCKEY_FACEOFF_DOT_IDS` order, `hockeyRinkLocation`, `nearestHockeyFaceoffDot` and
  `hockeyZone`. Snapping measures distance in feet, so the rink's 200 x 85 shape does
  not skew it, and exact ties go to the earlier id in that list. A point exactly on a
  blue line is neutral.
- `src/components/hockey/HockeyRink.tsx` draws the rink in a `0 0 200 85` foot viewBox:
  28 ft corners, goal lines clipped to the corners, creases, nets, blue and center
  lines, five circles, nine dots, and the trapezoid only when the rules enable it. The
  flip rotates the view 180 degrees and the tap handler undoes it. Markers accept
  `goal | saved | missed | blocked | event` for HKY-2B and HKY-2C to use.
- New `rink-*` color tokens exist in both themes, with a contrast test for lines on
  the ice and markers on their ink backing.
- The development preview (`/setup?sport=hockey&events=1`) shows the rink, its flip,
  and the zone and nearest dot of the last tap. Taps are not recorded yet.

### HKY-2B (implemented)

- Rules: `overtime` is exactly the four HKY-1 keys or those plus a boolean
  `suddenDeath`. `hockeyOvertimeSuddenDeath` reads a four-key snapshot as sudden death
  and never rewrites it. New profile rules and settings resolution always write the
  key (`withExplicitHockeySuddenDeath`). Two literal HKY-1 games in
  `src/lib/hockey/fixtures/` prove hydrate, park, resume, import, fingerprint and an
  overtime goal decide unchanged (`legacyRules.test.ts`).
- Events: `hockey.shot` (goal, saved, missed with miss type, blocked; optional location,
  empty net, penalty shot, strength, on-ice), `hockey.goalie_change` (put in, pull,
  new labeled opponent goalie) and `hockey.score_adjustment` (signed delta, reason).
  Commands live in `captureCommands.ts`; actor and on-ice checks in
  `captureProjection.ts`; the `hky_*` catalog in `stats.ts`.
- On-ice: an untouched section stores `not_recorded`. A complete set requires the
  recorder's confirmation plus between the period's minimum and cap of skaters (one
  more with an empty net), and `goalie` is a participant id, `empty_net` or null.
- Sudden death: in an active overtime whose rules have it, `decidedInPeriodId` follows
  the score after every goal and score adjustment: a lead decides the period and a tie
  clears the decision, so a +1 correction for a missed overtime goal decides and a
  tied game is never marked decided. Only pause, period end, match end, suspend,
  abandon, reopen and score adjustment may follow a decision; `finishDecidedHockeyGame`
  pauses, ends the period without a reason and ends the match. A tying adjustment after
  the decided period has ended also clears the decision.
- Goalie mismatches between a stamped goalie actor and the goalie in net become
  `actor_mismatch` warnings, not failures.
- The development preview records shots from a rink tap or the side buttons, goalie
  changes, and +1/-1 adjustments with a reason, and shows markers, shots on goal,
  warnings and the decided-game End button.

Deviations from the plan above:

- A goalie may be the scorer or an assister; only the blocker must be a skater.
- Goalie changes are allowed between periods as well as during one.
- Score adjustments change the score but not `periodTotals`.
- Profile versions were not bumped; the explicit `suddenDeath` key carries the change.
- `playerStatsById` holds only non-zero values, so HKY-1 fingerprints are unchanged.

### HKY-2C (implemented)

- Events: `hockey.faceoff` (neutral; `dotId` and `winner`; the location must equal the
  dot's exact point, and replay requires the tracked side's direction for the period),
  plus `hockey.hit`, `hockey.takeaway` and `hockey.giveaway` on the acting side with an
  optional location. The commands `recordHockeyFaceoff` and `recordHockeyPlay` live in
  `captureCommands.ts`, and the actor checks are in `captureProjection.ts`.
- Stats: `hky_fow`, `hky_fol`, `hky_hit`, `hky_tk` and `hky_gv`. The projection adds
  `faceoffs` (won and lost, in total and by zone from the dot and the period direction),
  `lastTrackedFaceoffTakerId`, and per-side `hits`, `takeaways` and `giveaways`.
- Taker default (`hockeyFaceoffTakerDefault`): the last tracked taker, else the first
  dressed C, else nobody.
- `recentEvents.ts`:
  - `hockeyRecentEvents` lists the ten newest rows. A capture unit is the events that share a
    `captureCommandId`, or a single event. Lifecycle and clock rows are shown for context.
  - `undoHockeyCapture` soft-deletes only the newest unit, and only when it is a capture.
    It must pass a candidate replay and a complete inspection.
  - `restoreHockeyCapture` uses one receipt, `capturePreferences.lastUndo`, which stays out of
    fingerprints, survives reload and park, and is dropped if malformed. Any new event
    clears it.
- The preview adds:
  - Each faceoff dot is its own tap target, 5 ft in radius and keyboard-focusable. Tapping
    it rings the dot and opens the faceoff control, so a faceoff takes two taps: the dot,
    then Won or Lost. Taker chips are optional. "Record something else at this dot" opens
    the chooser there instead.
  - A tap anywhere else opens the chooser (Shot, Faceoff, Hit, Takeaway, Giveaway). Its
    Faceoff option snaps to the nearest dot and takes a third tap.
  - A browser check at 390 px counted the path: dot tap, then Won, recorded the faceoff in
    two taps. A slot tap still opened the chooser, and the flipped view worked the same.
  - A play dialog, a quick Play button with no location, rink markers for located plays,
    and Recent Events with Undo and Restore.
  - A C position for its first preview skater, so the taker default has a centre to pick.
- `HockeyShotDialog`'s form pieces moved to `hockeyFields.tsx`, and
  `hockeyParticipantLabel` moved to `captureCommands.ts`, so the play dialog shares them.

Deviations from the plan above:

- Both players on a hit are optional, so a hit can be credited to the team only.
- Faceoffs are not drawn as rink markers; their zone totals are in the projection.
- Recent Events labels use the team names rather than "tracked" and "opponent".
