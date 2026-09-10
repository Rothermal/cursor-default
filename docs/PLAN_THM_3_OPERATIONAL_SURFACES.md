# THM-3: Operational surfaces

Status: THM-3A and THM-3B1/B2 implemented; THM-3B3 and THM-3C/D pending.
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
- **THM-3B3 pending:** SeasonInfo and remaining season management render components.
  Audit imports before converting; shared B1 panels do not make these hosts done.

### THM-3C: Cloud games and operational review

Inventory Games and GameInfo with their shared tables, filters, authority,
publication, recovery, and conflict controls. Sport-owned Summary and live
correction dialogs remain THM-4/THM-5, but record those dependencies explicitly.

### THM-3D: Statistics destinations

Inventory PlayerProfile, CareerStats, Leaderboard, TeamStats, TournamentStats,
and shared aggregate/provenance/pagination components. Test unavailable and
partial authorities, long names, dense rows, and both sports. Preserve intentional
chart/marker colors only with explicit contrast evidence.

## Completion rule

THM-3 is not complete after 3A. Each later slice must audit its imported render
components, add them to the shared color-ownership inventory, and record browser
evidence and outstanding deployed checks. No blanket completion claim for all
operational routes until 3B-3D finish.

See [3A verification](REGRESSION_THM_3A_SPORT_NAVIGATION.md).
