# THM-5: Soccer surfaces

Status: presentation implementation complete. THM-6 owns release signoff and the
public App appearance control. No migration or game-data change is required.

## Scope and invariants

- Setup, roster/opening lineup, live Tracker, score, clock and match actions.
- Shot, defense, foul, card, restart, historical and located-event editors.
- Lineup management/defaults/formation, Timeline and shootout surfaces.
- Recorder/finalization presentation and every Soccer Summary surface.
- Settings and aggregate destinations are included in the 38-component guard;
  already-converted surfaces retain their existing semantic tokens.

Application surfaces use the shared Light/Dark palette. Pitch colors are named
tokens with identical values in both themes: green turf, pale lines, yellow
tracked markers, blue opponent markers, dark marker outlines, and yellow/red
cards. Formation artwork shares the pitch surface/line tokens. Geometry, glyph
shapes, coordinate conversion, clustering and callback logic are unchanged.
Selection and disabled controls remain distinct; theme-color transitions are
removed without removing field rotation or other transform animation.

## Verification

- Full suite: 205 files, 1,720 tests passed, including 40 new Soccer appearance
  assertions and the updated exact formation-token guard.
- TypeScript and production/PWA build passed. Lint has zero errors and the
  three existing Fast Refresh warnings. Existing build warning categories
  (bootstrap/runtime CSS, Browserslist age and bundle size) remain.
- A temporary TypeScript AST comparison passed for all 38 inventory components,
  excluding className/fill/stroke attributes and presentation string constants.
  It compared geometry and non-presentation code against the integration branch.
- 76 temporary Playwright cases cover 19 modes at 390x844 and 1280x844 in both
  themes: Tracker, Setup, Player Setup, Summary, Timeline, Field, Formation,
  shot/historical shot, defense/foul/card/restart, substitution, clock, participant,
  rules, end-match, and shootout setup.
- 16 additional cases cover shot command success, recorder empty/error state,
  finalization unavailable state, and scoring dialog at the same dimensions.
- Browser assertions check nonblank rendering, page errors, horizontal document
  overflow and dialog bounds. Summary visits Players, Timeline, Field and
  Overview. Field checks computed turf color, keyboard marker/cluster selection,
  a capture callback and display flip. Shot capture calls the real command and
  verifies a successful result delivered to a spy, without persisting the result.
- Mobile Dark screenshots inspected for Tracker, capture, lineup and pitch.

Fixtures use real kickoff/projection with three local participants and a paused
clock; context callbacks and Supabase are mocked. Recorder/finalization checks
are error/empty presentation, not successful cloud transactions. Temporary
fixtures are removed before the production build and are not shipped.

## THM-6 release follow-through

Retain real-game create/track/park/resume/correct/finalize/reopen coverage in both
themes. Include populated shootout history, discipline and historical edits,
all recorder roles, canonical/alternate summaries, offline conflict recovery,
320px layouts, enlarged text, keyboard focus, installed PWA and reload behavior.
Verify theme switching never changes game fingerprints, dirty state or sync.
Do not interpret this batch as owner signoff on those end-to-end workflows.
