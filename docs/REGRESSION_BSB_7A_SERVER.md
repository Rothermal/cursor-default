# BSB-7A Server Foundation Regression

Status: **Server half implemented and locally verified; BSB-7A is not complete**
(2026-10-20). Owning scope: [BSB-7 sections 3, 4, 7 and 8](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md).
Migration [079](../supabase/migrations/079_baseball_aggregate_identity_foundation.sql)
has not been applied to a live project by this work. Owner application remains a
manual post-review/merge action. Baseball remains `opt_in`.

## Delivered Boundary

- Private RLS-protected personal publication pins and account/operation receipts.
  Pins freeze every canonical tracked participant key, including nulls, without
  changing canonical schema 1, setup, events or player-FK merge/delete behavior.
- An AFTER INSERT hook pins old and new finalizers inside their transaction.
  Historical active/invalidated publications bootstrap all-null only with valid
  tracked setup/rows and no unexpected non-null personal source. Anomalies receive
  no inferred credit and surface as invalid identity sources.
- Creator-only personal link review/write RPCs, current creator/guardian target
  authority, map/publication CAS, new duplicate-target refusal, same-target retries,
  operation-payload protection and atomic reasoned final Reopen-link. Successful
  linking never republishes automatically; receipt replay cannot reopen again.
- Reviewed-map finalization locks the game, compares the reviewed raw fingerprint,
  calls the unchanged finalizer, then verifies the inserted pin. Existing-final
  retries compare the original pin, never current remapped rows.
- The existing merge body is renamed privately and preserved exactly. Its public
  entry adds sorted player advisory and participant-row locks; linking takes its
  target advisory before the game/ordered participant locks. Pin hooks take no
  advisory locks. Established team merge authorization is unchanged.
- Verified unique audit chains resolve frozen UUIDs to currently authorized
  survivors. Unknown/deleted/unauthorized, cyclic and ambiguous lineage fail closed.
  Legitimate convergence preserves separate historical participant keys; same-target
  no-op links and later publication remain valid.
- The latest 075 pager receives bounded Baseball-only branches and fixed scope/player
  wrappers. Only active final `completed`, `run_rule`, `time_limit` publications
  contribute; broader BSB-6 finalization remains available. Personal filtering and
  returned identity maps both use pins, not operational participant rows.

## Server Interfaces

New fixed authenticated surfaces:

| RPC | Contract |
| --- | --- |
| `get_baseball_personal_participant_links(uuid)` | Exact review envelope: `contractVersion`, `sportId`, `gameId`, complete `participantSourceMap`, raw `mapFingerprint`, `activePublicationId` |
| `link_baseball_personal_participant(uuid,text,uuid,text,uuid,text,uuid)` | Game, canonical participant id, target player, expected map fingerprint/publication, reason, operation id; response adds the saved map and optional owned `reopen` handoff |
| `finalize_baseball_event_game_reviewed(uuid,uuid,jsonb,text,jsonb,text)` | Existing finalization inputs plus expected personal map fingerprint; existing publication response unchanged |
| `get_baseball_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)` | Latest-075 scope signature, default 20/range 1-50, paired timestamp/publication keyset |
| `get_baseball_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)` | Team contributions retain existing accepted-team read access; personal contributions also require game read plus target creator/guardian authority |

Baseball page items add `participantMapFingerprint`, `identityStatus` and
`identityDiagnostic`. Personal maps use canonical participant ids only and include
frozen nulls. The fingerprint describes the immutable raw pin; returned UUIDs may
resolve through verified merge lineage. Team maps remain on the existing mapper,
with null pin fingerprint. Invalid personal sources return null maps and an
explicit diagnostic, never a live-row fallback. Authorized personal player pages
can include invalid own-game diagnostic items without attributing them to a player.

The separate capability responses are exact:

```json
{"contractVersion":1,"sportId":"baseball","aggregateContractVersion":1,"migration":79}
{"contractVersion":1,"sportId":"baseball","personalLinkContractVersion":1,"publicationIdentityVersion":1,"reviewedFinalizationVersion":1,"migration":79}
```

Unavailable pieces return only `{"contractVersion":0}`. Both checks require the
enabled actual pin INSERT trigger. Aggregate and link RPC availability are checked
independently. The exact release contract 2 / migration 078 response and old
wrappers remain unchanged. No settings capability or schema ships here.

## Observed Evidence

Developer-focused source/compatibility command passed **4 files / 21 tests**:

```text
pnpm test src/lib/baseball/migration079.test.ts src/lib/baseball/migration078.test.ts src/lib/baseball/migration077.test.ts src/lib/hockey/migration075.test.ts --maxWorkers=2 --silent
```

The new 079 file contains **8** source-contract tests, including an exact bounded
comparison against the latest 075 pager. Source assertions are not SQL execution.

The [disposable harness](../supabase/tests/bsb7a/README.md) passed against actual
**PostgreSQL 16.14: 30 check groups, 46 expected refusals, 8 multi-connection races**.
Developer runs passed, and the coordinator independently reproduced that result.
The coordinator also reports a fresh Reviewer pass rebuilding actual migrations
001-079 from `template0`, rather than relying only on the pre-079 template. The
fixture generator passed **1 test** and produced **24** BSB-6 real-command cases.

The SQL groups verify historical bootstrap/anomalies, complete pins for both
finalizers and retries, injected receipt failure restoring publication/status/
scores/primary lock/audit/link state, stale expectations, receipt replay after
republication, current guardian/account refusals and private direct access denial.
They compare old/new sibling pager output over populated Soccer/Basketball/Hockey
fixtures and roles, and test tied keysets, scope/range/cursor behavior, eligible
outcomes, operational-map divergence and malformed/missing pins.

Eight real blocking scenarios cover link/link, finalize/link, link/reviewed-finalize,
reopen/link, merge/link, link/merge, reviewed-finalize/merge and old-finalize/merge.
The last two inject a test-only publication pause, commit the merge, then verify
reviewed rollback or consistent old-client pinning. Audit-chain checks cover
one-hop, chain, convergence, ambiguity, cycle, unknown/deleted and unauthorized
survivors. No production test hooks are installed by 079.

Coordinator-reported repository gates on the implementation working tree:
**313 files / 2,991 tests passed**, typecheck/build passed, lint **0 errors / 3
existing Fast Refresh warnings** (ignored local fixtures excluded), and **22
review-control tests passed**. These are reported separately from developer-focused
results. The fresh Reviewer's technical verdict is mergeable for this server-only
scope; final Git/PR handling and exact-candidate checks remain coordinator-owned.

## Still Pending

BSB-7A client capability parsing, transport, checked link commands/intents, pure
aggregate calculations, cancellation/quality handling and their tests remain
unimplemented. BSB-7B destinations/Legacy Totals/tournament attachment, BSB-7C
personal settings/setup and BSB-7D cutover are not delivered here. No frontend,
settings, legacy aggregate page, rollout, merge UI or live migration was changed.

Actual Supabase JWT/PostgREST/RLS behavior, live migration application, two-device
link/finalize/reopen/republish, physical-mobile and installed-PWA checks remain
pending. Local PostgreSQL roles/transactions and simulated auth are not those
checks. The [BSB-6 live exit matrix](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md) remains open,
and broader release is not approved by these passes.
