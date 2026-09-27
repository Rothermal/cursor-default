# BSB-2 Baseball Roster, Team Defaults and Setup Verification

Status: local implementation verification passed. Migration 071 must be applied by the
owner before Baseball team-default saves work; reads and game setup work without it.

## Automated and local checks

- Full Vitest suite: 238 files / 2,066 tests passed. `pnpm typecheck` and `pnpm build`
  passed. `pnpm lint` has 0 errors and the three existing context Fast Refresh warnings.
- `src/lib/baseball/settings.test.ts` (BSB-2A/2B): position normalization, labels and
  sort order; exact team settings parsing (unknown keys, profile, version, overrides,
  innings range, duplicate batters, a player at two positions, position 11, non-UUID
  ids); resolved rules keep the placed runner after regulation; stale-player flagging
  and explicit pruning; cloud and cache records accept only Baseball schema 1.
- `src/lib/baseball/setupBuilder.test.ts` (BSB-2C): defaults copied once and only for
  roster players, with missing players reported; undressing removes a player from the
  order and field; fielders move instead of doubling; the short fielder clears when
  rules drop to nine; built setups snapshot the roster with new participant ids; the
  engine's validation message is shown; opponent details are trimmed; a created game
  starts, reloads with an identical fingerprint, stays `unsupported` for cloud sync and
  survives park, export and import.
- `src/lib/baseball/previewGate.test.ts`: the setup and holding page are development-only,
  Baseball event games never reach the legacy stat grid, and consumers are audited.
- `src/lib/soccer/matchReadiness.test.ts` source pins updated for the shared
  `usesCodedPosition` roster branch (Basketball and Baseball).
- Migration 071 on a local Postgres 16 with stubs for the shared helpers: a valid payload
  saved; 11 invalid payloads were rejected with their messages (unknown key, unknown
  profile, profile version 2, unsupported override, non-integer and out-of-range
  innings, bad batting format, duplicate batter, player at two positions, position 11,
  inactive player); the private validator is not executable by `authenticated`, and the
  save function is.
- Browser smoke, dev server at 390px width, local mode: `/#/setup?sport=baseball&events=1`
  added ten local players, built a nine-batter order and defense, continued to `/game`,
  started the game (Top 1, 0 outs) and survived a reload with no page errors.

## Owner verification

1. Apply `supabase/migrations/071_baseball_team_settings.sql`.
2. In Team Manage for a Baseball team, set positions on a few players (standard, custom,
   Unassigned) and confirm they persist.
3. In the Baseball defaults panel, pick a profile, change innings, build a batting order
   and defense, and save. Reload and confirm the values. Deactivate one lineup player and
   confirm the stale warning blocks saving until "Remove unavailable players".
4. In a development build, open `/#/setup?sport=baseball&events=1`, pick the team, and
   confirm the lineup is prefilled from the defaults. Continue, start the game, park it
   and resume it from the Baseball dashboard.
