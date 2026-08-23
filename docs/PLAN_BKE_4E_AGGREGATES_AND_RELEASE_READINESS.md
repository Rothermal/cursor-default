# Plan: BKE-4E Canonical Aggregates and Release Readiness

Status: Product and delivery Q&A approved on 2026-08-20. BKE-4E is planned in five implementation
slices. BKE-4E1 through BKE-4E4 are implemented; BKE-4E5 is next. Basketball event-game creation remains
internal-only, and the user-visible event-model opt-in remains BKE-5.

## 1. Goal

Complete the Basketball cloud cutover without erasing the app's existing Basketball history.
BKE-4E will:

- project active completed Basketball canonical publications into season, team, tournament,
  player, career, and leaderboard destinations;
- combine those event-game contributions with authorized legacy Basketball history while using
  exactly one authority for each game;
- expose fixed, paginated, RLS-scoped Basketball aggregate source contracts;
- add a strict authenticated Basketball backend-capability handshake;
- retire legacy aggregate readers only for event-backed games while preserving every historical
  aggregate game; and
- consolidate the release evidence required before BKE-5 exposes event-model creation to users.

BKE-4E does not open the user-visible creation gate. It makes that later choice safe.

## 2. Non-Negotiable Boundaries

1. **One authority per game.** An event-backed game contributes only through its active canonical
   publication. A legacy game contributes only through resolved `game_stats` and legacy correction
   semantics. No destination reads both for one game.
2. **No event compatibility writes.** Event totals are never written to `game_stats`, `shot_chart`,
   or `stat_corrections`. Those remain legacy-only surfaces.
3. **Active completed publications only.** Reopened, invalidated, abandoned, suspended, unhealthy,
   or nonfinal event games do not contribute.
4. **Tracked-side authority.** Cross-game Basketball aggregates use only the canonical
   publication's tracked side. Opponent detail remains match-review context and cannot become
   another team's official history from someone else's recording.
5. **Stable identity only.** Player totals require a stable source player id. Names, jersey
   numbers, nicknames, and display labels never merge identities.
6. **No silent fallback.** A request for event-cloud creation cannot become a legacy game because
   a capability check failed. Every supported fallback is explicit and occurs before state
   mutation.
7. **Historical access survives release state.** Availability and capability policy never hides
   existing local, parked, cloud, Summary, aggregate, or recovery data.
8. **Soccer behavior is unchanged.** Shared SQL extraction retains fixed Soccer wrappers and exact
   Soccer response contracts. Basketball pages branch before legacy or Soccer loaders.

## 3. Approved Decisions

The focused Q&A approved all 24 recommended choices.

### Authority and inclusion

- Only active completed canonical publications contribute.
- Personal canonical games contribute to Player and Career when the tracked participant has a
  stable player identity. They do not contribute to team, season, or tournament scopes unless the
  game is explicitly associated with those scopes.
- Legacy and event games share historical destinations through a deterministic per-game authority
  partition. Valid mixed provenance can still be complete quality.
- The first release includes the complete BKE-2 traditional box score, recorded manual minutes,
  and denominator-safe shooting, eFG, true-shooting, and assist-to-turnover rates. Possession,
  lineup, plus-minus, pace, usage, and other completeness-dependent metrics remain deferred.

### Aggregate math and participation

- Projection-authoritative side totals own official team totals. Team/unknown events are included;
  visible player rows are not summed to invent team truth.
- Cross-game percentages and rates use summed raw numerators and denominators, never averages of
  per-game percentages.
- Before BKE-6, starters count as recorded appearances. Bench, late, and setup-DNP participants
  count when they have effective player-attributed stat activity or positive recorded minutes.
  Discipline attribution alone does not prove an appearance.
- Canonical score and result derive wins, losses, permitted ties, and regulation/overtime context.
  Abandoned and unhealthy games remain reviewable but do not enter records.

### Identity and quality

- Stable cloud player ids are the only player aggregation key.
- Historical identity repair requires audited merge lineage. Future merges remount participant
  source ids; unprovable identities remain unresolved.
- Team and season views union current active-roster zero-appearance rows with historical
  contributors who are no longer active.
- `complete | partial` source quality is distinct from `legacy | canonical | mixed` provenance and
  from metric-specific availability. Managers receive affected-game diagnostics; ordinary users
  receive concise status.

### Transport and refresh

- Public clients call fixed Basketball RPC wrappers over private sport-neutral cores. Broad public
  sport parameters and Soccer-named Basketball calls are forbidden.
- Source pages are RLS-scoped and keyset-paginated. They return only required metadata, canonical
  snapshots or resolved legacy contributions, and stable-player mappings.
- Transport, access, capability, and malformed-page failures reject the load. An isolated malformed
  source item is excluded with explicit partial quality.
- Destinations load on route entry, explicit Refresh, and guarded focus. Identical in-flight work
  is shared, consumers can cancel independently, and completed results are not persisted or polled.

### Destinations and presentation

- Only tracked-side participants enter cross-game aggregates.
- Basketball categories are Scoring, Shooting, Rebounding, Playmaking, Defense, Discipline, and
  Participation. Leaderboard defaults to Scoring sorted by points, then PPG, appearances, and name.
- Existing destination URLs remain canonical. Basketball branches early into Basketball-specific
  components instead of rewriting legacy pages or adding a parallel route tree.
- Player and Career always show Participation, hide other all-zero categories, retain per-game,
  season, and team history, and link directly to the authority-aware Summary.

### Capability and delivery

- One authenticated read-only Basketball capability RPC returns exact versions for binding,
  revision sync, finalization/reopen, canonical Summary, and aggregate source contracts. The client
  parses it strictly and caches only successful responses within one account session.
- Capability failure happens before active/parked state or cloud authority changes. BKE-5 may offer
  Retry, supported legacy-cloud creation, or local-only event tracking explicitly.
- Event destinations route to canonical sources before legacy RPCs. Legacy games and corrections
  remain supported indefinitely; event compatibility rows are not produced.
- Delivery uses five slices. Automated and focused checks apply per slice. BKE-4E5 consolidates the
  live matrix, which may remain pending while creation is internal but must be signed off before
  BKE-5 opens user opt-in.

## 4. Aggregate Authority and Eligibility

### 4.1 Event-backed games

An event contribution is eligible only when all of the following are true:

- `games.sport_id = 'basketball'`;
- the game has the immutable Basketball event setup that proves event authority;
- `games.status = 'final'`;
- the publication is Basketball, active, and not invalidated;
- the canonical snapshot rebuilds completely under the supported Basketball schema;
- the effective terminal lifecycle event is `basketball.match_ended` with reason `completed`;
- the current user can read the game; and
- the requested scope or stable player matches the source contract.

Reopen invalidation removes the game on the next route load, explicit Refresh, or guarded focus
refresh. No stale publication fallback is allowed.

### 4.2 Legacy games

A legacy contribution is eligible only when:

- `games.sport_id = 'basketball'`;
- no Basketball event setup exists for the game;
- the game is final under the existing legacy contract;
- the current user can read the game; and
- legacy rows and corrections resolve through the existing authoritative legacy semantics.

BKE-4E adds narrow paginated legacy-source RPCs rather than using an already-aggregated RPC that
has discarded game identity. Per-game identity is required to prove the authority partition,
produce game history, and disclose provenance.

### 4.3 Mixed history

The destination loader drains canonical and legacy source pages independently, then composes them
by stable game id:

```text
authorized scope/player
  -> canonical Basketball publication pages
  -> resolved legacy Basketball game pages
  -> reject duplicate authority or malformed source
  -> project each source in isolation
  -> combine by stable player/team identity
  -> publish complete or explicitly partial destination model
```

A duplicate game id across source families is an invariant failure. Canonical never silently wins
over a legacy row because the existence of both means the authority partition was violated.

### 4.4 Personal games

Personal event and legacy games are eligible only for Player and Career requests where the current
user can read the game and the tracked participant resolves to the requested stable player id.
Personal games have no synthetic team, season, or tournament ownership. Their history row is
labeled Personal, retains its source game id, and links to Summary when authorized. A team/season
Player Profile keeps personal contributions in a distinct Personal section and never folds them
into scoped team totals. Career may combine all authorized team and personal contributions.

## 5. Canonical Basketball Stat Contract

`src/lib/basketball/aggregateStats.ts` owns the exact aggregate vocabulary. Event projection and
legacy rows map into this vocabulary; neither input vocabulary becomes aggregate authority.

### 5.1 Canonical aggregate ids

| Category | Canonical ids |
|---|---|
| Participation | `bk_app`, `bk_start`, `bk_min_sec` |
| Scoring | `bk_pts` |
| Shooting | `bk_fgm`, `bk_fga`, `bk_2pm`, `bk_2pa`, `bk_3pm`, `bk_3pa`, `bk_ftm`, `bk_fta` |
| Rebounding | `bk_oreb`, `bk_dreb`, `bk_reb` |
| Playmaking | `bk_ast`, `bk_to` |
| Defense | `bk_stl`, `bk_blk` |
| Discipline | `bk_pf`, `bk_dq`, `bk_eject` |

No `bk_*` total is accepted from a canonical snapshot as independent truth. Every value is rebuilt
from the isolated Basketball projection. Direct base mappings include makes, offensive/defensive
rebounds, assists, turnovers, steals, blocks, and personal fouls. Attempts, combined totals,
participation, discipline outcomes, and converted minutes are constructed deterministically by the
aggregate engine.

Recorded manual minutes map to `bk_min_sec` by multiplying valid projected minutes by 60. BKE-6
can later supply exact interval seconds without changing the aggregate id. A result containing only
manual/legacy minutes labels minutes as recorded rather than clock-derived.

### 5.2 Source mapping and constructed totals

Event projection and correction-resolved legacy rows use the same Basketball base counter
vocabulary. Their one-way aggregate mapping is explicit:

| Canonical id | Required construction |
|---|---|
| `bk_ftm` | `ft` |
| `bk_fta` | `ft + ft_miss` |
| `bk_2pm` | `2pt` |
| `bk_2pa` | `2pt + 2pt_miss` |
| `bk_3pm` | `3pt` |
| `bk_3pa` | `3pt + 3pt_miss` |
| `bk_fgm` | `2pt + 3pt` |
| `bk_fga` | `bk_2pa + bk_3pa` |
| `bk_pts` | `ft + (2 * 2pt) + (3 * 3pt)` |
| `bk_oreb`, `bk_dreb` | `oreb`, `dreb` respectively |
| `bk_reb` | `oreb + dreb` |
| `bk_ast`, `bk_to`, `bk_stl`, `bk_blk`, `bk_pf` | the matching base counter |
| `bk_min_sec` | validated projected `min * 60` before BKE-6 |

`bk_app` and `bk_start` derive only from Section 6.1 participation rules. `bk_dq` derives from the
effective participant disqualification state, while `bk_eject` derives from effective explicit
ejection records. Legacy sources cannot fabricate those event-only facts; their availability is
tracked separately. Legacy stat corrections resolve before mapping. Base aliases and constructed
aggregate values are never written back to event snapshots or canonical publications.

### 5.3 Rates

Rates are calculated after summing raw totals:

- PPG = `bk_pts / bk_app`;
- FG% = `bk_fgm / bk_fga`;
- 2PT% = `bk_2pm / bk_2pa`;
- 3PT% = `bk_3pm / bk_3pa`;
- FT% = `bk_ftm / bk_fta`;
- eFG% = `(bk_fgm + 0.5 * bk_3pm) / bk_fga`;
- TS% = `bk_pts / (2 * (bk_fga + 0.44 * bk_fta))`; and
- AST/TO = `bk_ast / bk_to`.

A zero denominator produces unavailable, not zero. Per-game percentages are never averaged.

### 5.4 Team and result model

Team output keeps projection-authoritative tracked-side totals, including team/unknown actor
contributions, separately from visible player totals. It also retains:

- final tracked/opponent score;
- result from the tracked-side perspective;
- regulation and overtime score segments;
- completed game count and W-L-T record;
- opponent/date/team/season/tournament metadata; and
- source provenance plus Summary route context.

The implementation must test and disclose any difference between authoritative side totals and
the sum of resolved player rows. That difference is expected when team/unknown actors exist.

## 6. Participation, Identity, and Quality

### 6.1 Recorded participation

Until BKE-6 provides on-court intervals:

- an opening starter receives one appearance and one start;
- an opening bench or late participant receives one appearance only when an effective
  player-attributed stat event exists or positive recorded minutes remain;
- an inactive setup-DNP receives neither, while effective player-attributed activity or positive
  recorded minutes overrides that pregame designation for appearance credit only; and
- an ejection without effective stat activity or positive recorded minutes records discipline but
  does not prove that a bench or setup-DNP participant appeared; and
- a participant with only removed activity does not appear unless their opening status qualifies.

Legacy games count an appearance when the resolved player has a game-stat contribution or existing
legacy checkout/participation evidence. Starts unavailable from legacy data remain metric-specific
unavailable rather than fabricated or making the entire load partial.

### 6.2 Stable identity and merges

Canonical participant mapping uses `game_participants.source_player_id`. Migration 047 already
remounts future `game_participants` links during `merge_players_execute`; BKE-4E preserves that
behavior. Migration 060 may repair a null Basketball source id only when:

- a UUID-shaped original client player id exists;
- `player_merge_audit` proves a non-cyclic path to one surviving player;
- the surviving player is valid for the associated team, or is the authorized surviving personal
  player for a personal game; and
- the mapping is unambiguous.

No name/number repair and no aggregate-page mapping UI are allowed.

### 6.3 Quality dimensions

The read model keeps three independent dimensions:

1. `quality: complete | partial` for source health;
2. `provenance: legacy | canonical | mixed` for authority composition; and
3. metric availability, such as recorded-only minutes or unavailable legacy starts.

Malformed individual sources, unresolved tracked contributions, or identity conflicts produce
partial quality after healthy sources finish. Access, capability, page-envelope, or transport
failure rejects the load instead of presenting incomplete totals. Manager diagnostics may include
game ids and safe projection issues; ordinary status must not expose another recorder or schema
details.

## 7. Backend Source Contracts

### 7.1 Migration 060

`060_basketball_canonical_aggregate_sources.sql` will:

- extract migration 047's source paging into private sport-neutral helpers while preserving exact
  fixed Soccer wrapper signatures and payloads;
- add a trusted Basketball completed-snapshot policy for aggregate eligibility;
- add active-finalized Basketball publication indexes appropriate to keyset reads;
- expose fixed `get_basketball_scope_aggregate_publications` and
  `get_basketball_player_aggregate_publications` wrappers;
- expose fixed paginated Basketball legacy scope/player source wrappers that apply resolved legacy
  corrections and exclude every game with event setup authority;
- include team, season, tournament, and personal-player scope rules approved above;
- repair only provable audited Basketball participant lineage; and
- retain all existing merge, RLS, grant, and Soccer behavior.

Public wrappers accept only bounded scope/player ids, paired keyset cursors, and a page limit.
Private helpers remain revoked from `public`, `anon`, and `authenticated`. Fixed wrappers are
authenticated only and re-check app access plus game/scope authorization.

### 7.2 Page payload

Canonical items contain:

- publication id/number, finalized time, fingerprint, event count, and payload bytes;
- minimal game/scope metadata;
- immutable canonical snapshot;
- stable participant source map;
- tracked source side; and
- a manager-diagnostics capability bit.

Legacy items contain:

- game id/date/status/scope metadata;
- final score metadata needed for tracked-side result;
- resolved per-player and authoritative team stat rows;
- stable player ids;
- correction-resolved provenance metadata; and
- a manager-diagnostics capability bit.

No response includes invite tokens, private recorder streams, unrelated participants, or direct
table inventory.

### 7.3 Pagination

Canonical pages use `(finalized_at, publication_id)` descending. Legacy pages use a stable paired
cursor such as `(game_date, game_id)` descending. Limits are bounded to 1-50. Equal timestamp/date
fixtures must prove no skips or duplicates. All pages drain before a complete result publishes.

## 8. Client Aggregate Engine

### 8.1 Pure modules

```text
src/lib/basketball/aggregateStats.ts
src/lib/basketball/aggregateProjection.ts
src/lib/basketball/aggregateComposition.ts
src/lib/basketball/aggregateDestinations.ts
src/lib/basketball/aggregatePlayerDestinations.ts
```

These modules own the canonical catalog, event and legacy mapping, participation rules, isolated
per-game models, mixed-source composition, rates, sorting, histories, quality, and diagnostics.
They do not import React or Supabase.

### 8.2 Transport

`src/lib/basketball/aggregateTransport.ts` will:

- strictly parse every page and source item;
- drain canonical and legacy cursors independently;
- deduplicate publication and game ids;
- reject cross-authority duplicate games;
- share identical in-flight requests while keeping consumer cancellation independent;
- project in cooperative batches with progress and structured metrics;
- isolate malformed items as partial when safe;
- classify capability, access, transport, and malformed-envelope failures; and
- avoid completed-result persistence.

The Soccer transport remains behaviorally unchanged. Extract a truly sport-neutral helper only
when it preserves Soccer tests and removes concrete duplication; do not make one parser understand
both sport payloads through loose optional fields.

### 8.3 Destination hook

`useBasketballAggregateDestination` owns route-entry loading, guarded focus refresh, manual
Refresh, stale-consumer cancellation, roster best-effort loading, and the last coherent result
during refresh. A failed refresh reports stale/error state without replacing the last coherent
totals with a partial request.

## 9. Destination Experience

Basketball route guards run before existing legacy aggregate RPCs, just as Soccer guards do today.
Legacy-only and mixed Basketball use the new Basketball destination adapter; other sports remain
unchanged.

### 9.1 Leaderboard

- Opens on Scoring.
- Sorts by total points, PPG, appearances, then display name.
- Offers Scoring, Shooting, Rebounding, Playmaking, Defense, Discipline, and Participation.
- Every canonical aggregate stat and approved rate is rankable when that metric is available for
  the complete selected scope. A metric with structurally unavailable legacy contributions is
  suppressed rather than sorting unknown as a genuine zero. This includes `bk_start` when starter
  status is unknown and event-only `bk_dq` / `bk_eject` when eligible legacy games are present.
- Zero-appearance active roster rows remain visible where the scope supplies a roster.

### 9.2 Team, season, and tournament

- Reuse current route/query context.
- Provide Overview, Players, and Games.
- Overview shows record, scoring comparison, authoritative tracked-side totals, provenance, and
  quality.
- Players union active-roster zero rows with historical contributors.
- Games show legacy/canonical provenance and open the correct Summary authority.

### 9.3 Player Profile and Career

- Participation always renders; all-zero non-participation categories hide.
- Player Profile applies team/season scope, retains canonical and legacy game history, and shows
  authorized personal contributions separately from team totals.
- Career combines authorized team stints and eligible personal games for the requested stable
  player.
- History retains per-game totals, team/season labels where available, and direct Summary links.
- A personal contribution is labeled Personal rather than assigned to a fabricated team.

### 9.4 Empty and problem states

Distinguish:

- no eligible completed games;
- no resolved player contributions;
- no values in the selected category;
- inaccessible scope/player;
- backend capability update required;
- transport/retry failure;
- partial source quality; and
- metric unavailable for part of mixed history.

## 10. Capability Contract and Compatibility Retirement

### 10.1 Migration 061

`061_basketball_release_capabilities.sql` adds only the authenticated read-only handshake. It
returns an exact versioned object after verifying the complete BKE-4 operational boundary:

- Basketball v4 binding and revision transport;
- recovery/conflict and recorder-resolution contracts;
- canonical finalization and reopen;
- authority-aware Summary reads; and
- migration 060 aggregate source wrappers.

The first contract should include exact keys such as:

```text
contractVersion
migration
eventTransportVersion
recoveryVersion
recorderResolutionVersion
canonicalFinalizationVersion
summaryAuthorityVersion
aggregateSourceVersion
```

If any required object is unavailable, the RPC returns an older contract version without exposing
schema names. It grants no operational permission and never substitutes for RLS or team roles.
BKE-5 may bump/extend this contract for settings readiness before opening opt-in.

### 10.2 Client parser and cache

`src/lib/basketball/releaseCapabilities.ts` mirrors the proven Soccer behavior with Basketball-fixed
types and messages:

- exact shape and version parsing;
- backend-update versus client-update classification;
- offline, authentication, access, malformed, and generic failure states;
- one in-flight request shared per active user;
- successful-result cache isolated by user id; and
- explicit force refresh and auth-change clearing.

### 10.3 Preflight ordering

BKE-4E wires capability preflight into the internal Basketball event-cloud creation path without
making it user-visible. The check completes before `startNewGame`, parking/replacement, team-cloud
authority selection, or cloud binding. Failure retains all active/parked identities.

BKE-5 owns the visible choices:

- Retry capability check;
- use supported legacy cloud tracking;
- use local-only event tracking with the durability consequence stated; or
- cancel without mutation.

## 11. Delivery Slices

### BKE-4E1: Canonical stat contract and pure aggregate engine

Status: Implemented on 2026-08-20. See `docs/REGRESSION_BKE_4E_AGGREGATES.md`.

Scope:

- add the exact `bk_*` catalog, categories, formats, and approved rates;
- project isolated canonical snapshots and resolved legacy fixtures;
- implement recorded participation, tracked-side team totals, results, and provenance;
- compose canonical plus legacy games with one-authority enforcement;
- add mixed-history, personal-player, malformed, unresolved, and metric-availability fixtures; and
- keep global Basketball `SportConfig` live/legacy action categories unchanged while exposing the
  canonical aggregate catalog through the Basketball destination adapter.

Exit: pure fixtures prove every approved raw stat/rate, team total, result, participation rule,
identity boundary, and mixed-source invariant without React or Supabase.

No migration.

### BKE-4E2: Paginated source transport

Status: Implemented on 2026-08-20. See `docs/REGRESSION_BKE_4E_TRANSPORT.md`.

Scope:

- add migration 060 and its static contract tests;
- preserve Soccer wrapper/output parity;
- add fixed Basketball canonical and legacy scope/player source RPCs;
- implement strict transport, pagination, cancellation, shared in-flight work, progress, metrics,
  capability/access classification, and partial item isolation; and
- document/runtime-test RLS, equal-cursor pagination, audited identity repair, and future merge
  remounting.

Exit: authorized source pages round-trip into the E1 engine with no skipped/duplicated rows,
cross-authority duplicates fail closed, and Soccer remains unchanged.

Migration: 060.

### BKE-4E3: Team, season, tournament, and leaderboard destinations

Status: Implemented on 2026-08-21. See `docs/REGRESSION_BKE_4E_DESTINATIONS.md`.

Scope:

- add the destination hook and shared Basketball aggregate status/category/table components;
- route Basketball Leaderboard, Team Stats, and Tournament Stats before legacy readers;
- ship Scoring-first ranking, Overview/Players/Games, active-roster zero rows, historical
  contributors, result/score context, provenance, quality, diagnostics, Refresh, and focus reload;
  and
- preserve non-Basketball and legacy route behavior.

Exit: all team-owned destinations agree on the same mixed-history model and canonical event
contributions never enter existing legacy aggregate RPC paths.

No migration.

### BKE-4E4: Player, Career, and compatibility retirement

Status: Implemented on 2026-08-22. See `docs/REGRESSION_BKE_4E_PLAYER_CAREER.md`.

Scope:

- route Basketball Player Profile and Career through stable-player source pages;
- include authorized personal canonical/legacy games only in Player/Career;
- ship Participation-at-zero, category suppression, team/season/personal history, and Summary
  links;
- complete legacy/canonical mixed provenance and metric-availability presentation;
- audit all five destinations for no event `game_stats`, `shot_chart`, or `stat_corrections` reads;
  and
- document the permanent legacy-only reader boundary.

Exit: all five destinations agree on canonical ids/formulas, historical Basketball remains
continuous, and every game contribution has one explicit authority.

No migration.

### BKE-4E5: Capability handshake and release exit audit

Scope:

- add migration 061 and strict account-scoped client capability handling;
- preflight internal event-cloud creation before mutation;
- consolidate BKE-4B through BKE-4E automated and manual release evidence;
- audit stale PWA/client/backend, offline recovery, two-device/multi-recorder, roles, finalization,
  reopen, Summary, aggregates, mixed legacy history, personal games, and Soccer/legacy regression;
- update runtime and migration documentation; and
- keep production user opt-in closed for BKE-5.

Exit: the backend can safely negotiate the complete BKE-4 contract, automated release gates pass,
and the remaining live evidence is explicitly recorded as complete or as a named pre-BKE-5 gate.

Migration: 061.

## 12. Automated Verification

Every slice runs focused tests, the full Vitest suite, production build, ESLint, and
`git diff --check`.

Required coverage includes:

- exact canonical ids, uniqueness, categories, formatting, one-way base mapping, and explicit
  make-plus-miss attempt construction;
- every BKE-2 player/team stat, manual-minute conversion, denominator-safe rate, and no supplied
  aggregate-total trust;
- recorded starter/bench/late/DNP participation and removed-event behavior;
- official tracked-side team totals versus resolved player totals;
- completed/overtime/tie results and abandoned/reopened exclusion;
- canonical-only, legacy-only, mixed, team, and personal-player fixtures;
- stable identity, audited merge repair, unresolved contributions, and no name matching;
- canonical/legacy authority collision rejection;
- keyset equality boundaries, page draining, deduplication, cancellation, and in-flight sharing;
- malformed item partial quality versus page/access/capability failure;
- owner/admin/scorer/viewer/non-member/app-admin-without-team-role authorization;
- all five route destinations, Refresh/focus behavior, source transitions, Summary links, and
  mixed-scope unavailable-metric ranking suppression;
- strict capability versions, stale backend/client, malformed, offline, auth, access, retry, and
  account cache isolation;
- no preflight failure mutation;
- unchanged Soccer aggregate/capability contracts; and
- unchanged legacy Basketball, Baseball, Football, and Hockey routes.

SQL reviews cover grants/revokes, `search_path`, RLS authorization, stable functions, keyset index
use, bounded limits, private core exposure, payload minimization, migration lock duration, and
PostgREST schema reload.

## 13. Manual Release Matrix

BKE-4E5 creates `docs/REGRESSION_BKE_4E_RELEASE_READINESS.md` and carries forward the deferred live
BKE-4B/BKE-4C/BKE-4D evidence.

Record deployed commit, migration ceiling, account/role, device/browser, game/scope ids, and
pass/fail evidence for:

1. personal and team event binding on two devices, including offline queue recovery;
2. independent recorders, conflict preparation, primary selection, exact checkpoints, and late
   audit-only uploads;
3. completed finalization, active canonical Summary, reopen invalidation, correction,
   re-finalization, and publication history;
4. local/primary/alternate/canonical Summary tabs and read-only boundaries;
5. canonical-only, legacy-only, and mixed team/season/tournament/player/career destinations;
6. personal Player/Career contributions and team-scope exclusion;
7. zero-appearance roster rows, historical contributors, unresolved identity, audited merge, and
   partial malformed source;
8. owner/admin/scorer/viewer/non-member and app-admin-without-team-role behavior;
9. capability ready, missing migration, stale client, malformed response, offline, auth expiry,
   retry, and cross-account cache isolation;
10. active/parked state retained through every failed preflight;
11. phone/desktop and installed-PWA navigation, Refresh/focus, direct links, and stale-service-worker
    recovery; and
12. representative Soccer and legacy Basketball transport, summaries, aggregates, and settings.

Because creation remains internal, the owner may approve post-merge completion of live rows during
BKE-4E. Every unresolved row remains a hard gate before BKE-5 exposes the event-model opt-in.

## 14. Rollback and Failure Handling

- E1/E3/E4 client rollback restores the prior Basketball aggregate route branch. It does not
  modify games, publications, legacy rows, or Soccer behavior.
- Migration 060 is forward-only. Rollback stops calling its Basketball wrappers; do not delete
  canonical publications or undo audited participant remounting.
- Migration 061 is forward-only and read-only. A failed capability rollout keeps user-visible
  event creation closed.
- A failed destination load retains the last coherent result only during a refresh and labels it
  stale. Initial failure shows retry and no totals.
- A source authority collision, malformed page, or unauthorized scope fails closed.
- Disabling future rollout affects only new-game discovery/choice. Existing event and legacy data
  remain reachable.

## 15. Explicitly Out of Scope

- User-visible event-model opt-in, Basketball settings layers, and rule-profile UI: BKE-5.
- Anchored clock, stoppages, substitutions, on-court-five, lineup intervals, and exact derived
  minutes: BKE-6.
- Opponent-recorded stats becoming another team's/player's official aggregate history.
- Possession, pace, usage, plus-minus, lineup, or on/off metrics without complete source events.
- Historical aggregate-to-event conversion or synthetic canonical publication backfill.
- Public unauthenticated leaderboards or share pages.
- Persisted aggregate caches, materialized server totals, polling, Realtime invalidation, or a Web
  Worker before measured fixtures require them.
- Manual unresolved-player mapping by name or jersey.
- Broad redesign/reskin of legacy aggregate pages.
- Cross-recorder event merging or consensus totals.

## 16. Next Step

Begin BKE-4E5 from the implemented five-destination aggregate boundary and complete BKE-4 cloud
contracts. Keep the event-game creation gate internal and carry the complete BKE-4B through BKE-4E
live matrix into the capability and release exit audit.
