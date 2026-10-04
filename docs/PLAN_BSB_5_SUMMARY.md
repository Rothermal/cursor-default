# Plan: BSB-5 Baseball Game Summary

Status: approved (PR #465 merged 2026-10-03). BSB-5A merged (PR #469); BSB-5B merged (PR #471); BSB-5C in review. Owner questions Q1-Q6 are open;
slices follow the recommended answers until Mark decides otherwise.
Builds on BSB-1 ([engine](PLAN_BSB_1_EVENT_FOUNDATION.md)), BSB-3
([tracker](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md)) and BSB-4
([lineup and corrections](PLAN_BSB_4_LINEUP_AND_CORRECTIONS.md)). Product model:
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) sections 7, 8.4 and 16 (decision 7).

Exit condition (BSB-0 roadmap): a finished local game has a complete reviewable
Summary.

---

## 1. Goal

Give a Baseball event game the Summary BSB-0 section 8.4 describes:

- **Overview:** result, line score (runs by inning, R/H/E, LOB), pitcher decisions
  and the game facts (date, teams, rules profile, innings).
- **Box score:** batting, pitching and fielding for our team; opponent batting by
  slot and opponent pitching by pitcher label.
- **Play-by-play:** the whole game, oldest first, grouped by half-inning.
- **Spray chart:** where balls in play went, with filters.
- **Pitch plots:** where pitches crossed the zone, with filters.
- **Pitch counts:** per pitcher, both teams, against the profile's warnings and limit.
- **Pitcher decisions:** W, L, SV and HLD, suggested by the app and set by the
  recorder (BSB-0 decision 7).

The Summary is read-only review. Corrections stay on the tracker's Timeline tab
(BSB-4), and the Summary links there.

Out of scope:
- cloud review, finalization and canonical publication (BSB-6);
- season and career totals across games (BSB-7);
- pitch types, full earned-run reconstruction, cross-game rest rules (BSB-0 section 11).

Legacy Baseball stat-grid games keep today's Summary. Soccer, Basketball, Hockey and
Football are unchanged. Games stay local-only and behind the BSB-3D device toggle.

---

## 2. What the Engine Already Does

The BSB-1 projection already derives most of what the Summary shows:

- `lineScore`: runs, hits, errors and LOB per half-inning;
- `battingLines`, `pitchingLines` and `fieldingLines` keyed by participant (opponent
  batters by slot id, opponent pitchers by their label record);
- `plateAppearances`: one record per completed plate appearance with batter,
  pitcher, outcome, pitches, runs, RBI and the batted-ball location;
- `result`: outcome, winner and note; `pitchCountWarnings` and `pitchCountLimit` in
  the rules snapshot.

Gaps BSB-5 must close:

1. **No per-pitch list.** Pitch plots need each pitch's location, result, pitcher,
   batter, batter hand and the count before it. That comes from a replay of the
   pitch events, not from the projection.
2. **No batted-ball detail on plate-appearance records.** The spray chart needs the
   batted-ball type and result next to the location; both are on the stored event.
3. **No pitcher decisions.** Nothing records W, L, SV or HLD, and nothing suggests
   them.
4. **No Baseball Summary route.** `/summary` sends a Baseball event game to the
   legacy grid Summary, which has no data for it.

---

## 3. Phone Layout

`/summary` for a Baseball event game opens `BaseballSummary` with tabs, the same
pattern as Basketball and Soccer: **Overview**, **Box score**, **Plays**,
**Spray**, **Pitches**. The tab is kept in `?tab=` so reload and Back return to it.
Pitch counts sit on the Pitches tab under the plot.

- **Overview:**
  - the result line ("Aces 5, Visitors 3 · Final" or "Final in 5 (run rule)");
  - the line score as a scrollable table (one column per inning, extra innings
    included, then R, H, E), with LOB under it;
  - decisions, for example "W: #12 Lee · L: Visitors #21 · SV: #4 Kim" (no
    season records such as "(2-1)" until BSB-7);
  - a **Set decisions** button while the game is ended (section 4.4);
  - a warning card when the game has lineup warnings (`actor_mismatch`), linking to
    the Timeline.
- **Box score:**
  - our batting: AB, R, H, RBI, BB, K, then 2B/3B/HR/SB/HBP lines under the table
    (the familiar newspaper layout), with team totals and LOB;
  - opponent batting by slot, same columns;
  - pitching for both teams: IP (`6.2`), H, R, ER, BB, K, HR, pitches-strikes, with
    decision letters next to the name;
  - our fielding: PO, A, E, with DP, PB, SB allowed and CS under the table;
  - tapping a row opens that player's game details (the BSB-4A sheet).
- **Plays:** oldest first, half-inning groups with each half's line, scoring plays
  marked, a "Scoring plays only" filter. Rows open the read-only play details. A
  "Correct on the Timeline" link opens the tracker's Timeline tab while the game is
  on this device.
- **Spray:** the BSB-3A diamond with a dot per located ball in play, shaped by result
  (hit, out, error) and colored by team. Filters: team, batter, result, batted-ball
  type. Unlocated balls in play are counted under the chart ("3 not located").
  Tapping a dot opens the play details.
- **Pitches:** the BSB-3A catcher's-view zone with a dot per located pitch, colored
  by result (ball, called strike, swinging strike, foul, in play, HBP). Filters:
  pitcher, result, batter hand, count. Below it, **Pitch counts**: one row per
  pitcher for both teams with pitches, strikes, balls, batters faced and strike %,
  flagged when a warning threshold or the limit was reached.

Entry points:
- the tracker's result card (BSB-3D) and Game menu gain **Summary** once the game has
  ended; an in-progress game can open it from the Game menu too (partial Summary,
  labelled "In progress");
- a parked ended Baseball game opens on the Summary.

Every tab works at 390px in light and dark with no horizontal page scroll (tables
scroll inside their card).

---

## 4. Slices

| Slice | Content | Done when |
| --- | --- | --- |
| BSB-5A | Summary route, Overview (result, line score, game facts) and Box score | A finished game shows the line score and every box score total matching the projection |
| BSB-5B | Plays tab and Spray chart | Every play is listed by half-inning, and located balls in play plot with working filters |
| BSB-5C | Pitches tab: pitch plots and pitch counts | Every located pitch plots with working filters, and pitch counts flag warnings and the limit |
| BSB-5D | Pitcher decisions: suggestion and recorder assignment | Decisions can be set after the game ends, survive reload and reopen correctly |

### BSB-5A Route, Overview and Box score

- `summary.ts` (pure): `isBaseballSummaryRoute` and `baseballSummaryView(state,
  names)` with the result line, line-score columns (including extra innings and an
  unplayed bottom half shown as "X"), game facts and warning count.
- `boxScore.ts` (pure): batting, pitching and fielding rows in batting-order order
  (substitutes indented under the player they replaced), opponent rows by slot, team
  totals, the "2B: Lee, Kim" style footnotes and IP formatting.
- `BaseballSummary` page with the tab bar, Overview and Box score; the App route
  dispatch adds Baseball before the legacy fallback.
- Entry points from the tracker and the parked-game card.
- Source health: the Summary inspects and replays the stream with the same checks the
  tracker uses and never trusts cached totals. An incomplete or quarantined stream
  shows its recovery message and the last valid context, with no official totals,
  and never falls through to the legacy grid Summary. Batter, pitcher and fielder
  credit on every tab follows the replay after corrections, as in BSB-4.

### BSB-5B Plays and Spray chart

- `summaryPlays.ts` (pure): oldest-first half-inning groups reusing the BSB-4C
  capture units and labels, scoring-play flags from `replayBaseballRunsByEvent`, and
  the half line.
- `spray.ts` (pure): one point per located ball in play with team, batter, result,
  batted-ball type and the play id; filter helpers; counts of unlocated balls in play.
- `BaseballSprayChart` reuses `BaseballDiamond` geometry in a read-only mode with dots.

### BSB-5C Pitch plots and pitch counts

- `pitchLog.ts` (pure): a replay of pitch events giving, per pitch, the pitcher,
  batter, batter hand, count before the pitch, result, location and play id.
- `BaseballPitchPlot` reuses the `BaseballPitchPad` zone frame read-only.
- Pitch counts keep the shipped contract. The total is the projection's
  `pitchingLines` total, the same number the tracker shows and checks against
  `pitchCountWarnings` and `pitchCountLimit`, so the Summary and the tracker never
  disagree. That total is a lower bound: it includes individually recorded pitches
  plus the estimate `applyQuickPlateAppearance` adds from a Quick PA's final count
  (two-strike fouls cannot be recovered, and a Quick PA without a final count adds
  none).
- Each row splits the total into **Recorded** (pitch events, counted by the pitch
  log) and **Estimated** (total minus recorded), and shows "≥" when an estimate is
  included. Quick PA plate appearances are listed separately as **Untracked PA**
  (`untrackedPlateAppearances`). Unlocated pitches are a third, separate count: they
  are recorded pitches with no zone location, so they count as Recorded and appear in
  the pitch log but not on the plot.
- Counting only recorded pitches would change the tracker's warning contract and needs
  an explicit owner decision; this slice does not make it.

### BSB-5D Pitcher decisions

- A new event `baseball.pitcher_decisions` (schema 1, neutral to capture order,
  allowed only while the game is ended) with `{ win, loss, save, holds[] }` per side:
  participant ids for our pitchers, opponent pitcher ids for theirs, each nullable.
- `decisions.ts` (pure): the suggestion (section 4.4) and validation (a pitcher must
  have pitched for that side; W and L on opposite sides; SV only for the winning side
  and not the W pitcher; HLD never the W, L or SV pitcher).
- Lifecycle: each game end starts a completed-game epoch, identified by that end
  event's id, and a decisions event carries the epoch it was made for. The projection
  uses only decisions whose epoch is the current one, and there is no current epoch
  while the game is reopened, so Reopen clears the effective decisions even though
  the event stays in history. A new end starts a new epoch with no decisions, and the
  sheet asks again. Within an epoch the newest active decisions event wins as a whole
  (each one carries both sides), and removing it falls back to the one before.
- Edited history: when a later correction means stored decisions no longer validate
  (for example the W pitcher no longer pitched), they stay as recorded, show a
  "Check decisions" flag on Overview and the sheet, and never make the projection
  fail.
- Overview and Box score show the decisions; **Set decisions** opens a sheet seeded
  with the stored decisions or the suggestion. It is a capture unit, so Undo and the
  Timeline can take it back like any other row.

### 4.4 Decision suggestion

Following official scoring in simplified form, with the recorder confirming:
- **W:** the pitcher of record for the winning team when it took the lead for good.
  When that pitcher is a starter who did not complete the minimum innings (five,
  scaled to the profile's scheduled innings and rounded down), W is left blank for the
  recorder to choose among the relievers.
- **L:** the pitcher responsible for the run that gave the winners the lead for good.
- **SV** (Official Baseball Rules 9.19): suggested only when the last pitcher of the
  winning team finished the game, is not the W pitcher, pitched at least one out,
  never let the lead go (the winners led from the moment that pitcher entered to the
  end), and meets one of:
  1. entered with a lead of three runs or fewer and pitched at least one full inning
     (three outs);
  2. entered with the potential tying run on base, at bat or on deck (lead no larger
     than runners on base plus two);
  3. pitched at least three innings (nine outs).
  Otherwise SV is blank. It is also blank when the replay cannot establish
  eligibility (for example a Quick PA or warning leaves the entry state unclear) or
  when a profile's rules differ from OBR; the recorder decides those.
- **HLD:** not suggested; the recorder adds holds by hand.

No decisions are suggested for ties, forfeits, suspended or abandoned games.

---

## 5. Data and Compatibility

- BSB-5A to BSB-5C add no events, payloads or migrations; everything is derived.
- BSB-5D adds the `baseball.pitcher_decisions` event type. Older games simply have
  none. No setup or rules change.
- The Summary is fingerprint-neutral; only the decisions event changes game data.
- No Supabase migration; games stay local-only until BSB-6.

---

## 6. Cross-Sport Items Touched

- `App.tsx` Summary dispatch gains a Baseball branch before the legacy fallback
  (Baseball slot only).
- No change to Basketball, Soccer or Hockey Summary code. The tab, table and filter
  styling follows the existing Summary pages rather than introducing new shared
  components.

---

## 7. Tests and Regression

- **Box score:** totals match `battingLines`, `pitchingLines` and `fieldingLines`;
  substitutes order under the replaced player; IP formats `6.2`; opponent rows by
  slot; extra innings and an unplayed bottom half in the line score.
- **Plays:** half grouping oldest first, scoring flags, removed plays excluded.
- **Spray:** points only for located balls in play; filter combinations; unlocated
  counts; edited locations (BSB-4D) move the dot.
- **Pitches:** count-before for every pitch across a full plate appearance, including
  fouls with two strikes and Quick PA; batter hand from setup and opponent labels;
  filters; warning and limit flags.
- **Mixed pitch counts:** one pitcher with recorded pitches (some unlocated) and Quick
  PAs with and without a final count. Box score, Pitch counts and the tracker show the
  same total; Recorded, Estimated, Untracked PA and unlocated counts are each right;
  the warning threshold and the limit trigger on the same pitch in Summary and tracker.
- **Decisions:** the suggestion for a starter win, a relief win with a save, a short
  starter (blank W), extra innings and ties; validation refusals; reload, park and
  export/import keep them.
- **Save eligibility:** a reliever entering with two outs, bases empty and a three-run
  lead who gets the final out gets no SV; a reliever entering with the tying run on
  deck (or on base) who finishes the game gets SV; a reliever who gives up the lead and
  then finishes after the team retakes it gets no SV (and may be the W).
- **Decision lifecycle:** Reopen clears the effective decisions while the event stays in
  history; a new end asks again; the newest decisions in the epoch win and removing it
  falls back; an edit that invalidates stored decisions flags them without breaking the
  projection.
- **Routing:** a Baseball event game opens `BaseballSummary`, a legacy Baseball game
  still opens the grid Summary, and other sports are unaffected.
- **Browser smoke at 390px, light and dark:** each tab on a scripted seven-inning game,
  filters, decisions set and reopened, no horizontal scroll.

---

## 8. Risks

- **Decision rules are subtle.** The suggestion is a starting point; the recorder's
  choice always wins, and the sheet says so.
- **Large games.** A long game has hundreds of pitches; the pitch log and spray
  derivations are pure and memoized per stream revision.
- **Edited history.** The Summary always reads the current stream, so a BSB-4 edit
  updates every tab; decisions made before an edit stay as recorded and are flagged
  if they no longer validate.

---

## 9. Owner Questions

| # | Question | Options | Recommended |
| --- | --- | --- | --- |
| Q1 | Where should pitcher decisions be set? | **Summary** (Overview button after the game ends) / **End game** sheet / **Both** | Summary |
| Q2 | Should the app suggest W, L and SV? | **Yes** (prefilled, you confirm) / **No** (blank, you choose) | Yes |
| Q3 | Track holds (HLD)? | **Yes**, by hand only / **No** | Yes |
| Q4 | Can an in-progress game open the Summary? | **Yes** (labelled "In progress") / **No** (ended games only) | Yes |
| Q5 | Opponent box score depth? | **Batting by slot and pitching by label** / **Pitching only** | Batting by slot and pitching by label |
| Q6 | Pitch plot colors: by result only, or also a ball/strike-zone heat view? | **Result dots only** / **Dots plus a zone grid with counts** | Result dots only |

---

## 10. Delivery Record

Filled in as each slice merges.

- **BSB-5A (merged, PR #469):** `summary.ts` (route check, `?tab=`, `baseballSummarySource`
  rebuilding the projection with the tracker's inspect/replay checks, `baseballSummaryView`
  with the line score, "X" for the home half not needed, LOB, status and game facts) and
  `boxScore.ts` (batting by slot with substitutes indented and PH/PR/CR/DH labels, opponent
  batting by slot, pitching in mound order with "≥" pitch totals when Quick PA is included,
  tracked fielding, notes under each table). `replayBaseballLineupHistory` in the projector
  gives slot occupants, positions held and mound order from the same replay. `BaseballSummary`
  has Overview and Box score; an unhealthy stream shows the problem and no totals. Entry
  points: the tracker result card, the Game menu (also mid-game) and resuming a final or
  abandoned parked game. The lineup-warning card links to `/game?tab=timeline`. Pitcher HR,
  HBP, WP and BK sit in notes under the pitching table so it fits a phone.
- **BSB-5B (merged, PR #471):** `summaryPlays.ts` groups active capture units by half-inning,
  oldest first, with each half's line, runs per row from `replayBaseballRunsByEvent` and a
  scoring-only filter that drops empty halves. Pitches that only change the count fold into
  the row of the plate appearance they belong to ("Batter 4: Strikeout", "Before: Ball,
  Foul"); a runner play or change mid plate appearance keeps the earlier pitches as their own
  rows, and a pitch that ends the plate appearance without a ball in play is named by its
  outcome (strikeout, walk, HBP). Grouping and batter names follow
  `replayBaseballCreditByEvent`, so a corrected lineup regroups the plate appearance as the
  batting lines credit it; a row whose stamped batter differs says "Recorded for", and a folded
  pitch's lineup warning stays on its row. Lineup changes open details like plays, as on the
  Timeline.
  `spray.ts` plots located balls in play from the replayed plate appearances (Quick PA
  included) with team, batter, result (hit, out, error; FC and sacrifices count as outs) and
  batted-ball type filters and an unlocated count. `BaseballSprayChart` draws on
  `BaseballFieldShapes`, the painted field split out of `BaseballDiamond`. Rows and marks open
  the read-only play details, whose note links to `/game?tab=timeline`; the Plays tab also
  has a "Correct on the Timeline" link.
- **BSB-5C (in review):** `replayBaseballPitches` in the projector lists every recorded
  pitch with the count before it, the replay-credited batter and pitcher and the batter's
  hand at that time (setup for our players, the slot details for the opponent); Quick PA
  records no pitches. `pitchLog.ts` turns that into the pitch log (six plot kinds: ball,
  called strike, swinging strike including foul tips and missed bunts, foul, in play,
  HBP), the plot with pitcher, result, batter hand and count filters and an unlocated
  count, and pitch counts per pitcher in the box score's mound order. Count totals are the
  projection's `pitchingLines`; each row splits them into Recorded, Estimated (total minus
  recorded), Untracked PA and pitches without a location, shows "≥" when Quick PA is
  included, and flags warnings and the limit with `baseballPitchCountAlert`, the helper the
  tracker's scoreboard now uses too. `BaseballPitchPlot` draws on `BaseballZoneShapes`,
  split out of `BaseballPitchPad`, with a shape per kind as well as a color (new `--zone-*`
  tokens, contrast-checked in both themes). The Summary tab bar is five equal columns.
