# StatKeeper

Mobile-first, offline-first sports game tracking with team rosters, live events,
game review and optional authenticated cloud sync.

## Current App

- **Soccer:** released sport-specific setup, pitch capture, lineup management,
  Timeline, shootouts, Summary and canonical cloud results. Enable it in Settings.
- **Basketball:** existing aggregate games remain supported; the event tracker is
  a device-level opt-in with clock, lineups, corrections and cloud review.
  Its court UI modernization is planned, not yet implemented.
- **Baseball, Football and Hockey:** configuration and generic tracking foundations
  exist; do not treat these as completed sport-specific field experiences.

Availability and defaults are distinct: see
[sport availability policy](src/lib/sportAvailability.ts) and
[sport configuration](src/config/sports.ts).

The app supports multiple local games across sports, parking/resume, local recovery,
team and roster management, account access controls, and Light/Dark appearance.
Cloud event games use independent recorder streams and explicit canonical
publication; legacy Basketball uses a separate aggregate path. These are not
interchangeable authorities.

## Navigation

Sports -> sport dashboard -> New Game, active/parked games, Teams, Cloud Games or
Season Stats. Settings separates Account, App, sport preferences, Data and Advanced.

Live Soccer uses Field, Lineup and Timeline workflows. Basketball currently retains
a player selector and stat grid alongside court capture. The approved next direction
is surface-first capture, event-local player attribution and player details opened
from lineup cards, with a separate Manage Lineup action.

See [shared product decisions](docs/PRODUCT_AND_INTERACTION_DECISIONS.md) for the
target model and its implementation status. Opening a document is not evidence
that its proposed behavior has shipped.

## Local Development

React 18, TypeScript, Vite, Tailwind CSS 3 and HashRouter.

```sh
pnpm install
pnpm dev
```

Use the URL printed by Vite (normally http://localhost:5173). Routes use hashes,
for example `/#/game`. Without cloud configuration, use local tracking.

Optional cloud environment keys are documented in [.env.example](.env.example).
Use only client-safe publishable/legacy anon credentials in Vite variables; never
put privileged server keys or Google client secrets in the frontend. Local
credentials belong in ignored files.

Existing deployments must check their applied database state before running new
migrations. Migration files and operator scripts remain in
[supabase/migrations](supabase/migrations) and [supabase/scripts](supabase/scripts).
Read their prerequisites and the owning plan; this README is not a blanket
instruction to replay database history. Google provider setup is external.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test -- --maxWorkers=2
pnpm build
```

CI runs lint, tests and build. Browser/PWA, cloud and real-game verification are
recorded separately; passing unit tests does not certify those checks.

## Documentation

- [Deployment, cloud setup and PWA icon operations](docs/OPERATIONS.md)
- [Documentation index and active work](docs/README.md)
- [Codebase overview for contributors and agents](docs/AGENT_CODEBASE_OVERVIEW.md)
- [Shared product and interaction decisions](docs/PRODUCT_AND_INTERACTION_DECISIONS.md)
- [Basketball workspace modernization plan](docs/PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md)
- [Soccer field-test backlog](docs/PLAN_SOC_FIELD_TEST_BACKLOG.md)
- [Documentation archive audit](docs/DOCUMENTATION_ARCHIVE_AUDIT.md)
- [Runtime instructions and gotchas](AGENTS.md)

Completed implementation history lives in `docs/completed/`; superseded documents
and snapshots live in `docs/archived/`. Neither directory is an active task queue.
Outstanding verification and deferred issues must remain linked from the current index.

## License

Private; not licensed for distribution.
