# Regression: BKE-6A1 Rules and Setup Foundation

Status: Automated coverage passes. Migration 063 and its authenticated runtime checks remain manual
after merge.

## Delivered

- strict clone-safe `BasketballMatchRulesV3` with one exhaustive editable field catalog;
- immutable version-2 built-in profiles plus deliberate draft-only v3 upgrades;
- backward-compatible version-2 settings and an atomic v3 clock/lineup override bundle;
- strict setup version 2 opening-lineup authority while setup version 1 retains its old shape;
- migration 063 private settings validation and a separate exact clock/lineup capability RPC; and
- account-isolated strict client parsing with no production call site.

The current Player Setup path accepts only reviewed version-2 rules. Persisted v3 authority therefore
cannot create an incomplete setup-v1 game before BKE-6B adds the production setup workflow.

## Automated Evidence

```text
pnpm vitest run src/lib/basketball/clockLineupFoundation.test.ts \
  src/lib/basketball/clockLineupCapabilities.test.ts \
  src/lib/basketball/migration063.test.ts \
  src/lib/basketball/profiles.test.ts \
  src/lib/basketball/settings.test.ts \
  src/lib/basketball/setupDraft.test.ts \
  src/lib/basketball/profileDiffPresentation.test.ts
```

Result: 7 files, 39 tests passed.

Full repository evidence:

- `pnpm test`: 169 files, 1,160 tests passed;
- `pnpm lint`: 0 errors (6 pre-existing Fast Refresh warnings); and
- `pnpm build`: production TypeScript and Vite/PWA build passed.

## Post-Merge Supabase Check

Apply `supabase/migrations/063_basketball_clock_lineup_foundation.sql`, then run both calls from an
active authenticated session:

```sql
select public.get_basketball_release_capabilities();
select public.get_basketball_clock_lineup_capabilities_v1();
```

The first response must remain migration 062's exact contract. The second must be exactly:

```json
{"clockAndLineupsVersion": 1}
```

Anonymous, pending, suspended, and inactive access must not execute the new capability.
