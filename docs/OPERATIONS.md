# Operations

Current entry point for deployment and maintenance. Based on the checked-in
workflow/configuration; this documentation update did not deploy or change a database.

## GitHub Pages

Project URL: [StatKeeper](https://rothermal.github.io/cursor-default/).
Deployment health is determined by the latest Actions run, not this link's presence.

- [Deployment workflow](../.github/workflows/deploy.yml) runs on pushes to
  `stattracker` and supports manual dispatch. It installs dependencies, lints,
  tests, builds and publishes `dist` through GitHub Pages Actions.
- The workflow currently selects Node 20 and pnpm 9. Repository Pages settings
  must use GitHub Actions. See the [existing deployment guide](../GITHUB_PAGES_DEPLOY.md)
  for the settings walkthrough, subject to the configuration caveat below.
- [Vite configuration](../vite.config.ts) is authoritative: production base,
  PWA scope and start URL are `/cursor-default/`; local development base is `/`.
  The current service-worker registration uses `prompt`, not automatic activation.
  Do not copy the older guide's `autoUpdate` example over current configuration.
- Build identity is supplied as `VITE_APP_BUILD_ID` from the commit SHA. Accept the
  Update prompt before testing new behavior; refresh alone is not sufficient.
  Alternatively, close every client in scope and reopen after the waiting worker
  activates. Verify the displayed build identity matches the deployed commit before
  beginning verification. If Update asks to pause a running game, complete that
  guarded workflow; do not bypass it with a forced reload.

### Configured build and offline assets

PR CI builds with a public placeholder Supabase URL/key so it includes the same
SDK paths as deployment without exposing repository secrets. An unconfigured local
build can tree-shake those paths and is not a substitute for this configured check.
Vite places the Supabase SDK in its own vendor chunk. All JavaScript chunks remain
in the service worker's precache; the existing **3 MiB per-file** budget is unchanged.
Oversized files still fail the build instead of silently losing offline support.

The configured #502 follow-up build measured 2,997,113 bytes for the app chunk, leaving
**148,615 bytes (4.7%)** below the 3,145,728-byte limit; build-id/configuration values
can change the exact size. This is measured headroom, not a guarantee that a given
number of future feature slices will fit. Production builds now warn for any emitted
JavaScript chunk at or above **90%** of the limit, reporting its size and remaining
bytes before the unchanged hard failure threshold is reached. On GitHub Actions,
the same message is also emitted as a **PWA precache headroom** warning annotation,
visible in the check/run annotations without opening the raw build log. Local
builds retain the normal Vite warning without workflow-command output.

**Open follow-up:** introduce route-level splitting for per-sport tracker/statistics
pages before further growth consumes that headroom. Scope it separately from this
deployment repair: preserve provider/state lifetimes, safe active-game navigation,
the all-JavaScript precache policy and prompt-based updates; verify route navigation,
offline chunk loading and update/recovery behavior. The new config-source tests are
wiring guards, not artifact verification. The configured CI build, generated-worker
checks and browser cache/offline checks provide the behavioral evidence.

On 2026-10-22, the deployment of #500 and the following docs-only #501 failed at
service-worker generation: the configured app chunk was about 3.17 MB. Lint and all
3,179 tests passed; no Pages artifact was uploaded. This was not a database or
credential-authentication failure. Splitting the SDK addresses the bundle boundary;
rerunning the unchanged oversized build does not fix it. Installed-PWA validation
remains separate from build/precache checks.

## Cloud configuration

[.env.example](../.env.example) lists local client environment keys. The deployed
workflow currently reads repository secrets `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`; do not assume a local publishable-key variable is also
configured in Actions. The client resolves `VITE_SUPABASE_PUBLISHABLE_KEY` first,
then falls back to `VITE_SUPABASE_ANON_KEY`. The current URL-plus-anon-key secret
set is supported when populated with valid project credentials; an additional
publishable-key secret is not required. Never put service-role credentials or OAuth client secrets
in Vite variables. Provider configuration remains external.

For an existing database, inspect applied migrations and the owning feature plan
before running pending [migrations](../supabase/migrations/) or
[operator scripts](../supabase/scripts/). For a new environment, review the ordered
migration history and prerequisites before provisioning; do not use an archived
README as an unattended bootstrap script. No database work is authorized by this guide.

The [original integration plan](INTEGRATION_PLAN.md) preserves design history and
legacy aggregate context. Its old schema/checkout model is not authoritative for
current event-game publication; use current migrations and
[the codebase overview](AGENT_CODEBASE_OVERVIEW.md).

## PWA icon regeneration

Icons are already generated in `public/`. The optional maintenance script
[generate-icons.mjs](../scripts/generate-icons.mjs) imports `sharp`, which is not
a committed project dependency. From the repository root, when intentionally
regenerating the icons:

```sh
pnpm add -D sharp
node scripts/generate-icons.mjs
pnpm remove sharp
```

This overwrites `public/pwa-192x192.png`, `public/pwa-512x512.png` and
`public/apple-touch-icon.png`. Inspect all three images and the package/lockfile
diff, retaining only intended changes; do not discard unrelated dependency work.
If `sharp` was already deliberately installed, do not remove that dependency.
Run the production build and verify the installed PWA's icons after deployment.
These commands were documented, not executed, in this documentation PR.
