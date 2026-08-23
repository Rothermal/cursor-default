# Regression: BKE-4E5 Basketball Release Readiness

Status: BKE-4E5 implementation is complete. Migration 061 is required for internal Basketball
event-cloud creation. The user-visible event-model opt-in remains closed until BKE-5, and every
live row marked Pending below remains pre-BKE-5 release evidence.

## Contract Boundary

Migration `061_basketball_release_capabilities.sql` adds one authenticated, read-only RPC:
`get_basketball_release_capabilities()`. It verifies the public BKE-4 transport, recovery,
recorder, finalization, Summary-authority, and aggregate entry points without exposing missing
schema names. It grants no team role or operational permission and never replaces RLS.

The version-1 response is exact:

```text
contractVersion: 1
migration: 61
eventTransportVersion: 4
recoveryVersion: 1
recorderResolutionVersion: 1
canonicalFinalizationVersion: 1
summaryAuthorityVersion: 1
aggregateSourceVersion: 1
```

An older contract means the backend must be updated. A newer contract means the client must be
updated. Missing, malformed, offline, authentication, and access failures all fail closed.

## Creation Boundary

The internal Basketball event-model flow requires this preflight whenever cloud is available,
covering both Personal creation from a new/local roster and existing-team creation. It completes
before active-game confirmation, parking/replacement, cloud authority dispatch, game-info dispatch,
tournament writes, or binding. Legacy Basketball and genuinely local-only event setup when cloud is
unavailable do not call it. Existing local/cloud games, Summary, recovery, and aggregate reads are
never gated by release capability state.

Successful checks are cached only for the active account. Failed checks are not cached, concurrent
checks share one request, explicit retries bypass success cache, and auth-account changes clear the
cache.

## Automated Gate

Run the focused release and permanent Soccer parity suites:

```powershell
pnpm exec vitest run src/lib/basketball/releaseCapabilities.test.ts src/lib/basketball/migration061.test.ts src/lib/basketball/releaseEntryGuards.test.ts src/lib/basketball/aggregateTransport.test.ts src/lib/basketball/aggregateDestinationRoutes.test.ts src/lib/soccer/releaseCapabilities.test.ts src/lib/soccer/migration049.test.ts src/lib/soccer/releaseEntryGuards.test.ts src/lib/soccer/aggregateDestinationRoutes.test.ts
```

Then run:

```powershell
pnpm test
pnpm build
pnpm lint
git diff --check
```

Coverage proves exact parsing, stale backend/client classification, malformed/offline/auth/access
failure handling, cache sharing and account isolation, handshake-only SQL, complete BKE-4 object
checks, no preflight failure mutation, the internal creation gate, and unchanged Soccer contracts.

Local evidence on 2026-08-23: 56 focused tests passed; the full suite passed 1,028 tests across 151
files; production build passed; ESLint reported zero errors and the three existing context Fast
Refresh warnings; `git diff --check` passed.

## Migration Check

Apply migration 061 after migration 060. In an authenticated client session, the RPC must return
the exact object above. An unauthenticated call must fail, and an active account without a team role
may read the handshake but gains no team operation from it.

## Personal Profile Transport Decision

Migration 060 has no Personal-only player predicate. Player Profile therefore performs one scoped
team/season load plus one unfiltered authorized-player load and extracts only its Personal segment.
For the internal BKE-4 release this known extra drain is accepted so migration 061 remains a
handshake only. During the live matrix, record canonical/legacy page counts and load time for the
largest available career. BKE-5 should add a fixed Personal-only request only if that measurement is
material on target devices.

## Live Release Matrix

Record the deployed commit, migration ceiling, account/role, browser/device, local game id, cloud
game id, team id, and publication id with each result.

| ID | Scenario | Expected | Status |
|---|---|---|---|
| E5-01 | Personal and team binding on two devices, including offline edits | Resume-first adoption, same-recorder merge, durable retry, no duplicate binding | Pending |
| E5-02 | Independent owner/admin/scorer recorder streams | Streams remain isolated; manager detail and primary controls follow role | Pending |
| E5-03 | Conflict preparation, primary selection, and exact checkpoint | Stale/conflicting primary cannot finalize; confirmed checkpoint can | Pending |
| E5-04 | Complete, finalize, canonical review, reopen, correct, and republish | Publication history is append-only and active authority changes explicitly | Pending |
| E5-05 | Local, primary, alternate, and canonical Summary tabs | One authority per view; remote/terminal sources are read-only | Pending |
| E5-06 | Canonical-only, legacy-only, and mixed five-destination aggregates | One contribution per game, correct provenance, no compatibility dual read | Pending |
| E5-07 | Personal Profile/Career plus team-scope exclusion | Personal is separate on Profile, included in Career, excluded from team totals | Pending |
| E5-08 | Zero-appearance, historical, unresolved, merged, and malformed sources | Participation and quality states match the documented aggregate policy | Pending |
| E5-09 | Owner/admin/scorer/viewer/non-member/app-admin-only roles | Operational RPC/RLS remains authoritative after handshake success | Pending |
| E5-10 | Ready, missing, old, new, malformed, offline, expired auth, and retry | Typed fail-closed result; active and parked identities remain unchanged | Pending |
| E5-11 | Sign out/in across two accounts | No capability success or aggregate data crosses accounts | Pending |
| E5-12 | Phone, desktop, installed PWA, direct links, focus refresh, stale worker | Navigation and refresh recover without exposing event creation | Pending |
| E5-13 | Representative Soccer and legacy Basketball workflows | Existing capability, settings, sync, Summary, and aggregates remain unchanged | Pending |
| E5-14 | Largest available Personal career Profile load | Page count/time recorded; accepted extra drain is usable or promoted to BKE-5 fix | Pending |

The owner may complete these rows after merging because event creation remains internal. They must
not be represented as passed, and user-visible BKE-5 opt-in must not ship, until required evidence
is recorded or deliberately resolved.

## Rollback

Migration 061 is forward-only and read-only. Rollback the client call, not the function or BKE-4
data. A missing or failed handshake keeps only new internal event-cloud continuation closed;
historical reads and supported legacy/local paths remain available.
