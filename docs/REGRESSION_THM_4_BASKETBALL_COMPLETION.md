# THM-4: Consolidated Basketball completion

Status: remaining Basketball presentation implementation complete. Production
Dark remains gated until THM-6. No database migration or game-data change.

## Scope

- Legacy/event Tracker, shared player strip and 14 stat categories.
- Court SVG palette, capture/follow-up sheets, shooting summaries and charts.
- Timeline host, shared editor primitives and every historical editor family.
- Legacy Summary/corrections and event Summary's five tabs and player detail.
- Semantic Light/Dark stat and court tokens, centralized in appearance.css.

The stat category colors remain distinct; selected actors use the accent pair.
Made/missed markers retain circle/X shapes and side markers retain blue/orange
meaning. Court coordinates, geometry, hit targets and callbacks are unchanged.
Theme state does not enter setup, events, fingerprints, persistence or sync.

## Automated evidence

- Full test suite: 204 files, 1,680 tests passed. Lint: zero errors, the three
  existing Fast Refresh warnings in Auth/Game/Settings contexts remain.
- TypeScript and production/PWA build passed. Existing bootstrap/runtime CSS,
  Browserslist age and bundle-size warnings remain unchanged in kind.

- 32-file presentation inventory rejects raw palette utilities and opacity-only
  disabled controls; editor primitives and court token usage have focused guards.
- Palette tests check normal/active stat text and badge contrast in both themes,
  plus court hint text. Existing appearance surface tests remain applicable.
- A temporary TypeScript AST audit compared 31 UI files with the integration
  branch after excluding presentation attributes, class calculations, StatButton
  palette constants and the unused compatibility prop binding. Remaining ASTs
  matched. Court color edits were reviewed separately.
- Temporary local Playwright fixtures exercise 20 modes at 390x800 and 1280x800
  in Light and Dark (80 cases), checking page errors, nonblank rendering,
  document overflow and dialog bounds. Stat colors are checked as rendered CSS.
- Modes cover both Trackers/Summaries, Timeline, shot/related edits with Review
  and Back, historical shot/related additions, score/minutes, foul/free-throw,
  timeout/ejection, lineup error, chooser, court, capture popup and all stat colors.
- Summary visits all five tabs. Court tests keyboard marker activation and a
  blank-space capture callback. Stat increment verifies its callback.

Fixtures use actual event projection with local version-1 rules and mocked
contexts/dispatch; they do not write cloud data or prove full reducer workflows.
The popup test exercises Missed but does not assert the optional rebound step.
Lineup coverage here is an error state, not a replacement for earlier clock and
lineup regression evidence. Temporary harnesses are not shipped.

## Release checks retained for THM-6

Run actual legacy and event games through create, track, park/resume, correct,
sync, finalize, reopen and review. Include version-3 clock/lineup states, all
recorder authorities, offline/conflict recovery and canonical summaries.
Check 320px layouts, enlarged text, keyboard focus, flipped courts, overlapping
markers, follow-up assist/rebound capture, installed PWA and reload behavior.
No owner/cloud release signoff is implied by this presentation-only batch.
