# BSB-7A Server Foundation Regression

Status: **Server half implemented and locally verified; BSB-7A is not complete**
(2026-10-20). Owning scope: [BSB-7 sections 3, 4, 7 and 8](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md).
Migration [079](../supabase/migrations/079_baseball_aggregate_identity_foundation.sql)
was not applied to a live project by an agent in this work. The owner subsequently
reported it applied on 2026-10-20; no live behavior pass is inferred. The client half
is now tracked in [its own record](REGRESSION_BSB_7A_CLIENT.md). Baseball remains `opt_in`.

## Delivered Boundary

- Private RLS-protected personal publication pins and account/operation receipts.
  Pins freeze every canonical tracked participant key, including nulls, without
  changing canonical schema 1, setup, events or player-FK merge/delete behavior.
- An AFTER INSERT hook pins old and new finalizers inside their transaction.
  Historical active/invalidated publications bootstrap all-null only with valid
  tracked setup/rows and no unexpected non-null personal source. Anomalies receive
  no inferred credit and surface as invalid identity sources.
- Creator-only personal link review/write RPCs; link writes and receipt replay
  recheck current creator/guardian target authority. Review/finalization preserve
  already confirmed raw UUIDs after revocation; read-time pins still fail closed.
  Map/publication CAS, new duplicate-target refusal, same-target retries,
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

Developer-focused source/compatibility command passed **4 files / 22 tests** after
the PR #498 revocation repair:

```text
pnpm test src/lib/baseball/migration079.test.ts src/lib/baseball/migration078.test.ts src/lib/baseball/migration077.test.ts src/lib/hockey/migration075.test.ts --maxWorkers=2 --silent
```

The 079 file contains **9** source-contract tests, including an exact bounded
comparison against the latest 075 pager and separation of raw attribution from
current write/read authorization. Source assertions are not SQL execution.

The [disposable harness](../supabase/tests/bsb7a/README.md) passed against actual
**PostgreSQL 16.14: 33 check groups, 59 expected refusals, 8 multi-connection races**
in the developer's revocation-repair run. It cloned the actual pre-079 template,
applied the revised 079 and dropped its own database on completion.

Before this follow-up, the foundation harness passed **30 groups / 46 expected
refusals / 8 races**, independently reproduced by the coordinator and a fresh
Reviewer, including a rebuild of actual migrations 001-079 from `template0`.
Those earlier passes do not establish verification of the revocation repair.
The fixture generator passed **1 test** and produced **24** BSB-6 real-command cases.

### PR #498 Revocation Repair

Comment `6295677243` identified current target authorization inside raw-map capture
as a publication blocker after guardian removal. Before the fix, the new invariant
failed (**1 failed / 8 passed**) and the SQL harness stopped after **6 completed
groups**, reproducing `Baseball personal source identity is invalid` on link review
after the real SEC-4 removal RPC. These failures are not passing evidence.

The bounded repair removes only that authorization check from raw capture, leaving
structural identity and missing-confirmed-source corruption guards intact. Game
creator/active-account checks, every link-write/receipt-replay target check and the
read-time pin resolver remain unchanged. No signatures, schemas, capabilities or
rollout flags changed; the not-yet-live 079 is edited in place.

Three new SQL groups cover both old/reviewed finalizers for unfinalized and
previously-final/reopened personal games after actual `remove_player_guardian`,
pin/fingerprint retention, rejected new writes/replay, invalid aggregate items and
reclaim revalidating the same pins. A real authorized merge from a creator-only
identity whose guardian row was removed to an unauthorized survivor confirms raw
review and both republication paths still work while aggregate reads fail closed.
No arbitrary source replacement or guardian authority is inferred.

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

Coordinator-reported repository gates before the revocation follow-up:
**313 files / 2,991 tests passed**, typecheck/build passed, lint **0 errors / 3
existing Fast Refresh warnings** (ignored local fixtures excluded), and **22
review-control tests passed**. These are reported separately from developer-focused
results. The earlier fresh Reviewer's technical verdict covered the server-only
foundation; revocation-repair independent rereview, final Git/PR handling and
exact-candidate checks remain coordinator-owned.

Coordinator follow-up evidence: **313 files / 2,992 tests passed**, build passed,
lint **0 errors / 3 baseline warnings** (ignored `qa.local` fixtures excluded),
**22 review-control tests** and the focused **4 files / 22 tests** passed. An
independent fresh-build PostgreSQL 16.14 run passed **33 groups / 59 expected
refusals / 8 races** (`qa.local/bsb7a_a6f2efdb82554468/result.json`). The coordinator's
actual SEC-4 RPC probe changed all six formerly blocked paths from failure to
success while preserving raw pins/fingerprints and invalid aggregate identity.
Standalone `pnpm typecheck` passed with exit 0. Fresh independent review and
exact-head CI results are recorded in the PR.

## Still Pending

At the server-only delivery, BSB-7A client capability parsing, transport, checked
link commands/intents, pure calculations and cancellation/quality tests were not
included. They are now implemented separately in the [client record](REGRESSION_BSB_7A_CLIENT.md),
without completing the full 7A exit. BSB-7B destinations/Legacy Totals/tournament attachment, BSB-7C
personal settings/setup and BSB-7D cutover are not delivered here. No frontend,
settings, legacy aggregate page, rollout, merge UI or live migration was changed.

Actual Supabase JWT/PostgREST/RLS behavior, independent live migration verification, two-device
link/finalize/reopen/republish, physical-mobile and installed-PWA checks remain
pending. Local PostgreSQL roles/transactions and simulated auth are not those
checks. The [BSB-6 live exit matrix](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md) remains open,
and broader release is not approved by these passes.
