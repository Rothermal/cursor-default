# THM-3D1 verification

## Scope

BasketballAggregateDestination, its Page wrapper and inline state/table/quality
renderers use semantic colors. No data, authority, ranking, routes or hook changes.
No migration. Production Dark remains gated until THM-6.

TeamStats and TournamentStats use the wrapper; Leaderboard embeds the renderer.
BasketballPlayerAggregateDestination imports its shared state/quality renderers.
Those surrounding hosts remain pending in THM-3D3/4; no blanket route completion.

## Evidence

- 203 test files / 1,543 tests pass, including 90 appearance surface tests.
  TypeScript and production build pass. Lint has no errors and the same three
  existing Fast Refresh warnings in context modules.
- Color ownership and disabled refresh fill/text guards cover the component.
  A layout guard bounds both sticky player header/body cells to 180px.
- Synthetic local Edge fixture rendered the actual Page and component at 390px
  and 1280px in Light/Dark. Overview, Players and Games tabs, partial-quality
  notices, loading and access-denied states passed without document overflow or
  page errors. Long team/player names were included. Sticky column width was
  checked in all four combinations after fixing its previously unbounded width.
- Light desktop Overview and Dark mobile Players screenshots inspected. Native
  ranking select, selected category and opaque sticky cells use semantic colors.
  Temporary fixture and screenshots removed; synthetic hook data bypassed cloud.

## Deployed follow-up

Verify real team/season/tournament scopes, rank/category changes, horizontal table
scrolling, partial managed diagnostics, refresh failures, empty/no-player states,
and navigation to canonical/legacy games and player/career views. Check installed
PWA and mobile keyboard behavior before enabling Dark. Synthetic presentation
checks do not establish cloud authority or complete the remaining route hosts.
