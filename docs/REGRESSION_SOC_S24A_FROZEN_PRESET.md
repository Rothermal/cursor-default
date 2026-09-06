# SOC-S24A Frozen Team Default Regression

**Status:** Automated coverage complete; migration 069 and deployed smoke pending
**Scope:** Soccer setup v2, frozen Team Default derivation, legacy compatibility,
cloud setup binding, and release capability preflight

## Automated checks

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The focused contracts cover:

- exact setup-v2 validation, cloned preset storage, and setup-v1 normalization;
- continued Soccer state-version 1/2 reads and strict rejection of unknown versions;
- formation-first and lineup-default preset derivation plus deselection pruning;
- fingerprint and cloud transport preservation of the exact preset;
- migration 069's Soccer/Basketball setup-v1/v2 allow-list and private binder;
- exact account-scoped release contract v2 parsing; and
- unchanged historical migration 049 and migration 052 definitions.

## Deployment order

1. Apply `supabase/migrations/069_soccer_setup_v2_compatibility.sql`.
2. Confirm `get_soccer_release_capabilities()` returns contract version 2,
   migration 69, and setup snapshot version 2 for an active authenticated user.
3. Deploy the S24A client only after steps 1-2 pass.

Without migration 069, new cloud-team Soccer setup fails before local game
mutation. Local setup plus existing game, history, sync, recovery, finalization,
and reopen access remain available.

## Operator smoke

| # | Scenario | Expected |
|---|---|---|
| 1 | Open an existing setup-v1 Soccer game | It loads normally; no Team Default is invented |
| 2 | Start a cloud-team match with a valid saved formation | Player Setup uses the formation once; recorder edits do not change the frozen Team Default |
| 3 | Start a cloud-team match without an applicable formation but with lineup defaults | Active saved starters and roster roles form the frozen Team Default |
| 4 | Deselect a default participant before kickoff, park, reload, and export/import | The participant stays absent from both match roster and frozen preset |
| 5 | Start a local/personal match | Setup v2 stores no Team Default |
| 6 | Sync and reopen a setup-v2 cloud match | The exact preset survives binding, pull, conflict/recovery state, and fingerprint checks |
| 7 | First-bind disposable Soccer v1/v2 and Basketball v1/v2 games after migration 069 | All four reviewed pairs bind; unsupported versions fail before setup writes |

S24A intentionally has no live Team Default action. S24B defines the atomic
transition event and S24C exposes Opening Lineup and Team Default in the live
lineup manager.
