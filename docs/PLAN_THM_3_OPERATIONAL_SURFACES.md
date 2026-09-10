# THM-3: Operational surfaces

Status: THM-3A/B/C and THM-3D1/2/3/4a implemented; THM-3D4b pending.
Deployed release checks remain open.
Parent: [App theming](PLAN_APP_THEMING.md). Requires THM-1 and THM-2.

## Delivery slices

Keep each surface family in a separate PR. All slices preserve routes, access,
game authority, state, data loading, and existing workflows. Production Dark
remains gated until THM-6; no branding persistence is included.

### THM-3A: Sport navigation

`src/pages/SportSelect.tsx` and `src/pages/SportDashboard.tsx`: choice, disabled/
missing sport, current game, parked games, sync notices, and management shortcuts.
Use neutral operational headers like Settings, retaining the existing sport icon
and name. A sport gradient is not a readable content surface for both palettes;
court/field colors and sport configuration remain unchanged. Buttons, notices,
cards, and muted text use existing tokens. No new palette values are required.

### THM-3B: Team and season management

Inventory `Teams.tsx` (shared list/manage host), TeamInfo and its panels, roster,
schedule and SeasonInfo plus team-specific settings/formation/legacy-import
components. Shared THM-2 audit/guardian/rules fields are already converted; do not
duplicate that work. Verify both sport settings hosts and read-only destinations.
Subdivide further if the concrete component inventory cannot be reviewed safely.

- **THM-3B1 implemented:** TeamInfo, all twelve `team-info` render components,
  and SegmentedControl. Overview, read-only roster/schedule, members, tournaments,
  result badges, and loading/unavailable states use semantic colors. Grid panels
  permit shrinking for long names; result badges stay on one line. No data or
  permission changes. See [verification](REGRESSION_THM_3B1_TEAM_INFO.md).
- **THM-3B2 implemented:** Teams list/manage host, AccessUnavailable, invite links,
  both team settings hosts, Basketball legacy import, Soccer formation, lineup
  defaults, and rules override editors. Shared THM-2 fields remain unchanged.
  Formation pitch/markings and its assigned/open slot artwork retain exact fixed
  colors; surrounding controls, warnings, and picker use semantic tokens. The
  color inventory permits only those counted literal artwork strings.
  SoccerGameSetup also uses the rules editor, and GameTracker uses AccessUnavailable;
  those children now theme but do not complete their host routes (THM-4/5).
  See [verification](REGRESSION_THM_3B2_TEAM_MANAGEMENT.md).
- **THM-3B3 implemented:** SeasonInfo header, team links, rename controls,
  loading/unavailable states, plus dedicated TeamRoster and TeamSchedule hosts
  identified in PR review. Their RosterPreviewCard and GameCard children were
  converted in B1; both hosts are now included in the color inventory. SeasonInfo
  has no imported render components. Season
  create/edit/delete and legacy configuration are already covered by THM-2's
  Admin, SeasonTeamStatsEditor, and ConfirmDialog inventory; the team creation
  season picker is THM-3B2. See [verification](REGRESSION_THM_3B3_SEASON_MANAGEMENT.md).

### THM-3C: Cloud games and operational review

Inventory Games and GameInfo with their shared tables, filters, authority,
publication, recovery, and conflict controls. Sport-owned Summary and live
correction dialogs remain THM-4/THM-5, but record those dependencies explicitly.

- **THM-3C1 implemented:** Games list, status/chart badges, opponent editor,
  loading/error/empty states, and action controls. Its only imported UI component
  is the previously themed ConfirmDialog. Resume, delete, cloud readers, role
  checks, and source selection remain unchanged. See
  [verification](REGRESSION_THM_3C1_CLOUD_GAMES.md).
- **THM-3C2 implemented:** GameInfo host identity/details, status, stat leaders,
  loading/unavailable states and open-game actions use semantic tokens. ResultBadge
  was converted in B1. BasketballRecorderManager and BasketballFinalizationPanel
  were subsequently converted in C3; C2 alone did not complete those subtrees.
  All loading, authority, finalization callbacks and resume logic stay unchanged.
  See [verification](REGRESSION_THM_3C2_GAME_INFO.md).
- **THM-3C3 implemented:** BasketballRecorderManager and BasketballFinalizationPanel,
  including their inline stream inspection, publication history, preview, conflict
  and reopen dialogs. Both have only GameInfo as a consumer and import no further
  UI panels. Mutating logic remains unchanged. Primary commands use accent tokens;
  success/warning/error indications retain their semantic meaning. Dialog surfaces,
  scrims, reason input and disabled controls use existing tokens. Shared Summary
  and live tracker surfaces remain THM-4/5. See
  [verification](REGRESSION_THM_3C3_REVIEW_PANELS.md).

### THM-3D: Statistics destinations

Inventory PlayerProfile, CareerStats, Leaderboard, TeamStats, TournamentStats,
and shared aggregate/provenance/pagination components. Test unavailable and
partial authorities, long names, dense rows, and both sports. Preserve intentional
chart/marker colors only with explicit contrast evidence.

- **THM-3D1 implemented:** BasketballAggregateDestination and its Page wrapper,
  inline overview/player/game tables, provenance, quality, loading/error/empty
  states. No imported UI panels. TeamStats and TournamentStats use this wrapper;
  Leaderboard embeds the renderer. Shared state/quality exports also improve
  BasketballPlayerAggregateDestination; its remaining content is covered by 3D3.
  Sticky player columns are bounded for long names; header buttons do not shrink.
  Data, rankings, routing and authority are unchanged. See
  [verification](REGRESSION_THM_3D1_BASKETBALL_STATISTICS.md).
- **THM-3D2 implemented:** SoccerAggregateDestination and its Page wrapper,
  inline overview/player/game tables, quality diagnostics and loading/error/empty
  exports. It imports no other UI panels. TeamStats/TournamentStats use the wrapper;
  Leaderboard embeds the renderer. SoccerPlayerAggregateDestination consumes its
  shared state/quality exports; its remaining content is covered by 3D3. Injected
  `overviewExtra` content and route hosts remain 3D4. Existing semantic tokens,
  bounded sticky player columns and nonshrinking header buttons mirror 3D1;
  rankings, cloud readers and authority are unchanged. See
  [verification](REGRESSION_THM_3D2_SOCCER_STATISTICS.md).
- **THM-3D3 implemented:** BasketballPlayerAggregateDestination,
  SoccerPlayerAggregateDestination and PlayerStatSummaryTables. Totals, category
  grids, personal contributions, expandable career segments, game history, and
  legacy per-game/high-game rows use semantic tokens. Their only imported UI
  panels are the already-converted aggregate state/quality exports. Refresh
  buttons retain their size and semantic disabled fill/text; long Basketball
  history source names wrap. Profile/Career route shells remain 3D4. No data,
  authority, ranking or callback changes. See
  [verification](REGRESSION_THM_3D3_PLAYER_STATISTICS.md).
- **THM-3D4a implemented:** PlayerProfile and CareerStats hosts, including legacy
  branches and missing/loading/error states. All imported render components were
  covered in 3D3. Neutral headers replace fixed gradients; Profile player names
  wrap and Career's back control retains its size. Data loading, game handoff,
  permissions and navigation stay unchanged. See
  [verification](REGRESSION_THM_3D4A_PROFILE_CAREER.md).
- **THM-3D4b pending:** Leaderboard, TeamStats and TournamentStats hosts, including
  legacy branches, injected overview extras and remaining render helpers. This
  split keeps the five substantial route hosts reviewable in two PRs.

## Completion rule

THM-3 is not complete after 3A. Each later slice must audit its imported render
components, add them to the shared color-ownership inventory, and record browser
evidence and outstanding deployed checks. No blanket completion claim for all
operational routes until 3B-3D finish.

See [3A verification](REGRESSION_THM_3A_SPORT_NAVIGATION.md).
