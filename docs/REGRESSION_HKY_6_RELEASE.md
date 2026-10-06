# Regression: HKY-6 Summary, Aggregates and Release

Record for [HKY-6](PLAN_HKY_6_SUMMARY_AGGREGATES_AND_RELEASE.md). Each slice adds its
section when it lands. Unit tests and builds do not establish live Supabase, installed PWA
or owner sign-off; those are listed separately.

## HKY-6A1 Summary: source, Overview, Skaters and Goalies

No migration and no event, payload, setup or rules change.

### Automated

| Area | Cases | Result |
|---|---|---|
| Per-game lines (`gameLines.test.ts`) | Paired 2-0 games with the scorers in the other order (the GWG moves, totals equal); the same game with and without `emptyNet` on one goal; a removed winning goal (the GWG moves to the next goal); a recorded-later goal placed in period 1 before the new winner; an unattributed winner; a score adjustment (GWG unattributed); an opponent win (no GWG); a backup goalie who never plays (no GP, no GS); two goalies in a tie (T to the goalie in net at the end, no shutout); a shootout loss (OTL, shutout with no regulation or overtime goals against, shootout lines); goalie time across a pulled goalie, a change between periods, a running game (incomplete) and the ended game (complete) | 8 pass |
| Summary (`summary.test.ts`) | Route predicate (local event game, `gameId` with `sport=hockey`, other sports and stat-grid games excluded); query round trip and Back paths; ended and abandoned games resume on the Summary, running and suspended games on the tracker; source selection: local without cloud calls, final cloud game from its publication, live cloud game from the primary stream, a local copy bound to a final game reads the publication; missing publication, missing primary and a failed cloud read name the problem; a publication that has not ended and an unreadable stream show no totals but keep the setup; result, periods, team stats (blocked shots by the defending side, faceoffs, PIM), scoring rows with assists and the GWG, penalty rows; skaters in jersey order; tracked goalies with decisions, a backup marked as not played, opponent goalies from the tracked side's shots; suspended status with its reason; power play and penalty kill with a clock | 10 pass |
| Hockey folder | `npx vitest run src/lib/hockey/` | 28 files, 367 tests pass |
| Full suite | `pnpm test` | 281 files, 2632 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Browser

Playwright with Chromium against `pnpm dev`, a fresh local anchored game made through
setup: two goals for, one against and a save each way, then Game menu > Summary.

| Check | Result |
|---|---|
| Summary opens from the tracker's Game menu on Overview, labelled This device | Pass |
| Overview: In progress, `2-1`, goals and SOG for period 1, team stats, scoring summary with times and running score, no penalties | Pass |
| Skaters and Goalies tabs; the unplayed backup shows Did not play; time in net marked incomplete while the clock runs | Pass |
| Light and Dark at 390 px, Dark at 1280 px; no horizontal page scroll (wide tables scroll inside their card) | Pass |
| Back returns to the tracker; Abandon with a reason, then Summary shows Abandoned and the reason | Pass |
| Console errors | None |

### Not yet checked

- A cloud game's Summary from Game Info (final and not final) against the live project;
  covered by the source tests with injected reads only.
- Installed PWA and a real phone.
- The owner's live game on the HKY-6A and 6B build (plan §7 Q5).
