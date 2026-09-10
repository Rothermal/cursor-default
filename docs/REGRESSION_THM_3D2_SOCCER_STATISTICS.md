# THM-3D2 verification

## Scope

SoccerAggregateDestination, Page wrapper and inline state/table/quality renderers
use semantic tokens. No cloud, ranking, authority, routing or hook changes. No
migrations. Production Dark remains gated until THM-6.

TeamStats/TournamentStats consume the wrapper; Leaderboard embeds the destination;
SoccerPlayerAggregateDestination imports its state/quality exports. Their other
content, including host-injected overview extras, remains pending in THM-3D3/4.

## Evidence

- 203 test files / 1,548 tests pass, including 95 appearance surface tests.
  An initial run timed out in an unchanged Basketball release-policy test; the
  full rerun passed without changes to that test. TypeScript/production build
  pass. Lint has zero errors and three existing context Fast Refresh warnings.
- Shared guards cover semantic color ownership, disabled refresh fill/text,
  uniquely identified nonshrinking Back/Refresh buttons, and both 180px sticky
  player cells. Basketball guards remain covered by the same parameterized tests.
- Synthetic local Edge checks at 390px and 1280px in Light/Dark exercised
  Overview/Players/Games, expanded managed diagnostics, loading, access-denied
  and empty states. Long player/team names remained within the document; sticky
  column width was bounded in all four combinations. No page errors.
- Light desktop Overview and Dark mobile Players screenshots inspected, including
  warning contrast, selected tabs/category, ranking select and opaque sticky cells.
  Synthetic hook data bypassed cloud; temporary fixture/screenshots removed.

## Deployed follow-up

Verify real team/season/tournament scopes, ranking/category changes, horizontal
table scrolling, refresh failures, no-player states, and game/player navigation.
Check installed-PWA and mobile keyboard behavior before enabling Dark. Synthetic
presentation checks do not establish real cloud authority or route completion.
