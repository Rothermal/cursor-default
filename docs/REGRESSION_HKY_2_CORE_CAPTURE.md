# HKY-2 Hockey Rink and Core Capture Verification

Status: local verification passed for HKY-2A to HKY-2E. No migration. Production gains
one owner-only, default-off device toggle (Q2); owner verification on a phone remains.

## Automated and local checks

- Full Vitest suite: 245 files / 2,190 tests passed. `pnpm typecheck` and `pnpm build`
  passed. `pnpm lint` has 0 errors and the three existing context Fast Refresh warnings.
- HKY-2A to HKY-2C coverage is listed in the HKY-2 plan §8 delivery records
  (`rinkGeometry.test.ts`, `capture.test.ts`, `plays.test.ts`, `legacyRules.test.ts`).
- `src/lib/hockey/setupBuilder.test.ts` (HKY-2E) covers:
  - a team roster dressed in actor order, goalies dressed as goalies, no inferred starters;
  - the starter limit, and lineup picks cleared when a player is undressed, re-dressed,
    removed, or the roster is replaced;
  - quick local entry by jersey numbers;
  - period length and clock model stored as match overrides only when they differ;
  - form messages for a missing goalie, too few skaters and bad period lengths;
  - a frozen setup that passes the strict parser, holds only dressed players and keeps
    the source team and season;
  - a new local game starting period 1 paused, surviving hydration, and reaching no
    cloud route.
- `src/lib/hockey/releasePolicy.test.ts` (replaces the HKY-1 preview gate test) covers:
  - the `opt_in` stage, the toggle requirement in production, rollback to `internal`,
    and the development preview without the toggle;
  - the stored toggle defaulting off and failing closed on malformed values;
  - the setup route applying the policy, the tracker route never consulting it, and
    the audited list of policy consumers.
- Browser checks at 390 px:
  - Development: a local game from jersey numbers plus a named goalie; the missing-goalie
    message; the period 1 direction chosen by tapping the rink end; Start game opening
    `/game` at 12:00 after a 12-minute override; the clock running; a two-tap faceoff; a
    quick Home goal updating score and SOG; Pause, then End period from the Game menu
    with a reason; Start Period 2 and End game showing between periods; reload keeping it all.
  - Production build: with the toggle off, the event setup URL showed the notice and
    New Game opened the legacy setup; the Hockey settings switch stored the opt-in;
    New Game then opened the event setup and started a game; turning the toggle off
    again still reopened that game at `/game`.

## Owner verification

Run on the deployed build, on a phone:

- Settings -> Sports -> Hockey: the New event tracker switch is off by default.
- With it off, Hockey New Game opens the stat-grid setup.
- With it on, play a full local game:
  - faceoffs, shots, a goal with assists and on-ice players, a goalie pull and an
    empty-net goal, a score adjustment, Undo and Restore;
  - reload mid-period with the clock running.
- Both clock models, and both period 1 directions with the rink flip on and off.
- An overtime goal ending a sudden-death game (High school profile), and a tie standing
  after regulation (Youth profile).
- Park the Hockey game, start a Soccer or Basketball event game, and resume Hockey.
- Turn the switch off: the parked or active Hockey game still opens.
- Rollback: set `SPORT_EVENT_RELEASE_STAGES.hockey` to `'internal'`; the switch shows
  "Unavailable in this build" and existing games still open.
