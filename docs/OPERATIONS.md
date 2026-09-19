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
- Build identity is supplied as `VITE_APP_BUILD_ID` from the commit SHA. Verify
  the deployed build and refresh installed PWAs deliberately before testing new behavior.

## Cloud configuration

[.env.example](../.env.example) lists local client environment keys. The deployed
workflow currently reads repository secrets `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`; do not assume a local publishable-key variable is also
configured in Actions. Never put service-role credentials or OAuth client secrets
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
