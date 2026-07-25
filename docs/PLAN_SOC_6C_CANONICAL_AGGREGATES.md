# SOC-6C Canonical Soccer Aggregates

Status: SOC-6C1 implemented; SOC-6C2 paginated canonical source transport is next.

## 1. Goal

Project completed soccer matches from the active canonical publication into the existing season,
team, player, career, and tournament destinations without creating a second aggregate authority.
The browser will rebuild each authorized canonical setup/event source with the deterministic
TypeScript projector, then combine the resulting raw totals.

SOC-6C does not write canonical soccer totals to `game_stats`, include abandoned or invalidated
publications, merge unresolved participants across games, include shootout statistics, or add
per-90/per-standard-match rates.

## 2. Fixed Product Boundary

- `soc_*` is the canonical soccer stat-id family in `SportConfig`.
- A narrow compatibility map may read pre-release development ids; it must not create a second
  permanent stat vocabulary.
- Cross-game player totals include only participants resolved to stable cloud player ids.
- Managers can see how many participants or contributions were excluded because identity remains
  unresolved.
- Aggregate percentages are calculated after summing their raw numerators and denominators.
- Only completed, active canonical publications contribute.
- Abandoned matches remain reviewable in Summary but do not contribute to first-release aggregates.
- Shootout statistics remain game-scoped.
- Existing aggregate routes are reused with soccer-specific categories, sorting, formatting, and
  empty states.
- Source access remains RLS-scoped and paginated. The client never receives an unrestricted
  aggregate feed.

## 3. Planned Delivery Slices

The implementation will use four reviewable slices:

1. **SOC-6C1 - Canonical stat contract and aggregate engine (shipped)**
   - Replace legacy soccer `SportConfig` ids with the canonical `soc_*` catalog.
   - Add the narrow development compatibility map.
   - Add pure canonical-publication projection and cross-game aggregate helpers with fixtures.
2. **SOC-6C2 - Paginated canonical source transport**
   - Add the next Supabase migration with narrow, RLS-scoped aggregate-source RPCs.
   - Add typed pagination/load helpers and publication/event/payload/projection instrumentation.
3. **SOC-6C3 - Season, team, and tournament destinations**
   - Route soccer scopes through the canonical loader and aggregate engine.
   - Preserve existing basketball and legacy-sport behavior.
4. **SOC-6C4 - Player, career, and release hardening**
   - Add soccer player/career views and manager-only unresolved exclusion reporting.
   - Complete performance measurements, regression coverage, docs, and failure states.

## 4. Canonical Stat Presentation

The first release exposes every implemented canonical player stat, grouped into:

- Participation
- Attack
- Defense
- Discipline
- Goalkeeping

Total assists (`soc_ast`) are the primary displayed/sortable assist value. Primary and secondary
assists remain available in detailed tables as `soc_ast_primary` and `soc_ast_secondary`.

Playing time remains canonical raw seconds (`soc_min_sec`). Display it as `MM:SS` below one hour
and `H:MM:SS` at one hour or above. Aggregation sums seconds before formatting.

Player games played counts only matches in which the player recorded an appearance. Starts remain
a separate total, and an unused match-roster entry does not increase player games played.

Every goalkeeper who qualifies for a completed-match clean sheet receives one clean-sheet
appearance, including every qualifying goalkeeper when the game-level result is `shared`. Do not
split shared credit fractionally. Team clean sheets are counted independently.

Aggregate rates use the same reviewed formulas as match summary:

| Rate | Combined formula |
|---|---|
| Shot accuracy | shots on target / shots |
| Goal conversion | goals / shots |
| Tackle win | tackles won / tackles attempted |
| Goalkeeper save | saves / shots on target faced |

Sum numerators and denominators across included publications before division. Hide rates with a
zero denominator and display available rates with their raw values.

Team and season tables include active roster players with zero appearances and historical
contributors who are no longer active. Show `0 APP` in aggregate tables; `DNP` remains a
single-match review label.

Team result summaries include matches, wins, draws, losses, goals for, goals against, goal
difference, and team clean sheets. This is descriptive team performance, not standings: SOC-6C
does not add points, rankings, or competition tiebreakers.

The primary team For/Against table stays compact:

- goals;
- shots;
- shots on target;
- corners;
- offsides;
- fouls;
- yellow cards;
- red cards.

Advanced team/unknown attribution diagnostics do not appear as ordinary team statistics.

Canonical score adjustments affect official W-D-L and goals for/against. They never create player
goals or assists. Existing canonical clean-sheet eligibility and unavailable states remain
authoritative.

Managers receive an expandable unresolved-identity warning with affected-match count, unresolved
participant-instance count, excluded contribution count, and links to affected match summaries.
The aggregate engine never merges unresolved participants by name or jersey.
Detailed identity/projection diagnostics are restricted to owner/admin users for each affected
team. Scorers and viewers receive a generic partial/exclusion notice.

`soc_cs` is a read-model stat derived from the reviewed clean-sheet eligibility rules. It is not a
client-authored event total. Aggregate percentages remain formulas over raw canonical stat ids and
do not become stored stat ids.

### Canonical player stat catalog

| Category | Canonical ids |
|---|---|
| Participation | `soc_app`, `soc_start`, `soc_min_sec`, `soc_cs` |
| Attack | `soc_goal`, `soc_own_goal`, `soc_ast`, `soc_ast_primary`, `soc_ast_secondary`, `soc_shot`, `soc_sot`, `soc_key_pass`, `soc_chance_created`, `soc_pen_att`, `soc_pen_goal`, `soc_dfk_att`, `soc_dfk_goal` |
| Defense | `soc_tkl_att`, `soc_tkl_won`, `soc_tkl_lost`, `soc_int`, `soc_clear`, `soc_recovery`, `soc_block` |
| Discipline | `soc_foul_committed`, `soc_foul_drawn`, `soc_yellow`, `soc_red` |
| Goalkeeping | `soc_gk_save`, `soc_gk_ga`, `soc_gk_sot_faced`, `soc_gk_pen_faced`, `soc_gk_pen_save` |

`soc_app` is the aggregate games-played numerator because a soccer participant can record at most
one appearance in a match. `soc_cs` is added only after a healthy completed projection passes the
SOC-6B clean-sheet rules. Shootout activity never increments any id in this table.

## 5. Canonical Source Transport

Use two narrow RLS-scoped RPC paths:

1. Team/season/tournament publication scopes.
2. Player/career publication scopes backed by indexed `game_participants.source_player_id`
   relationships.

Both paths use newest-first keyset pagination on `(finalized_at, publication_id)`. The default page
size is 20 publications and the server-enforced maximum is 50.

Each publication row returns:

- publication id, number, fingerprint, and finalized timestamp;
- minimal game metadata required by the destination;
- the immutable `canonical_snapshot`;
- a server-built mapping from match-local participant/player identities to stable
  `source_player_id` values;
- a continuation cursor.

Do not re-fetch raw `game_events`, project totals inside PostgreSQL, or return client-authored
`game_stats` as canonical soccer data.

The client automatically drains every page for the selected scope and displays loading progress.
It publishes one complete aggregate result only after every page succeeds. A transport failure
shows a retry state and never presents partial totals as complete.

Abort a load when its scope/filter changes or its page unmounts. Only the newest request may
publish progress or results. Deduplicate identical in-flight requests, but do not persist or reuse
completed aggregate results in SOC-6C.

A load records structured metrics for page count, publication count, event count, serialized
payload bytes, network time, projection time, total time, unresolved exclusions, and malformed
publications. Log the metrics in development. Show detailed metrics to managers only alongside a
partial/problem state; ordinary users receive concise product-facing status.

Project publications in small deterministic batches, yield between batches, and update visible
progress. Add a Web Worker or server/materialized aggregate cache only after measured fixtures show
that this path is insufficient.

Reload aggregate sources on route entry, explicit Refresh, and window focus. Do not add polling or
Realtime subscriptions in SOC-6C.

Season results include only teams the current user is authorized to read. Multi-team season UI
describes this as the user's accessible teams and never reveals names or counts for inaccessible
teams.

Personal-scope cloud games remain game-summary only because they intentionally have no stable
team/player identities. They do not enter account-level or cross-game aggregates in SOC-6C.

A malformed active publication is different from a transport failure. Continue aggregating
healthy publications, but label the result prominently as partial for every user. Managers also
receive affected-game links and projection diagnostics. Never silently skip malformed canonical
data.

### Migration 047 RPC contract

Add `supabase/migrations/047_soccer_canonical_aggregate_sources.sql`.

The scope RPC accepts:

```text
get_soccer_scope_aggregate_publications(
  p_scope_type: team | season | tournament,
  p_scope_id: uuid,
  p_before_finalized_at: timestamptz | null,
  p_before_publication_id: uuid | null,
  p_limit: integer = 20
)
```

The stable-player RPC accepts:

```text
get_soccer_player_aggregate_publications(
  p_player_id: uuid,
  p_team_id: uuid | null,
  p_season_id: uuid | null,
  p_before_finalized_at: timestamptz | null,
  p_before_publication_id: uuid | null,
  p_limit: integer = 20
)
```

Both return a JSON object containing `items` and `nextCursor`. Enforce `1..50` for `p_limit`;
reject incomplete cursor pairs; order by `finalized_at desc, publication.id desc`; fetch one extra
row to derive `nextCursor`.

Every item contains:

```text
publicationId, publicationNumber, snapshotFingerprint, finalizedAt,
eventCount, payloadBytes,
game: {
  id, date, status, cloudScope, teamId, seasonId, tournamentId,
  trackedTeamName, opponentName
},
canonicalSnapshot,
participantSourceMap,
canManage
```

`participantSourceMap` maps match-local participant and player ids to the current
`game_participants.source_player_id`. It is server-built and never inferred from names. `canManage`
comes from current owner/admin authority for that item's team.

Selection requirements:

- active publication only (`invalidated_at is null`);
- `games.status = 'final'`;
- soccer only;
- canonical snapshot end reason `completed`;
- team-scoped games only;
- `can_read_game(game_id)` for every returned item;
- exact requested scope membership;
- player RPC rows must have an indexed `game_participants.source_player_id = p_player_id`.

Add a private SQL helper that reads the latest active `soccer.match_ended` /
`soccer.match_reopened` control event from `canonical_snapshot.eventStream.events`. The RPC includes
only snapshots whose terminal active control event is `soccer.match_ended` with reason
`completed`. The client must still rebuild and verify the completed projection before aggregation.

The scope RPC returns the readable subset of a multi-team season. It must not return or count
inaccessible teams. The player RPC may apply optional team/season filters but cannot broaden game
visibility. Revoke public execution and grant only to `authenticated`.

Migration 047 must also replace the latest `merge_players_execute` definition from migration 041
and repoint `game_participants.source_player_id` from the duplicate to the survivor before deleting
the duplicate player. Migration 041 predates `game_participants`; without this addition the foreign
key's `on delete set null` behavior would make finalized soccer participants unresolved. There is
no uniqueness conflict on this column, so this remount needs no user-facing merge resolution.

This fix may remain coupled to SOC-6C2 because Soccer stays development-only through SOC-6E and
there is no supported production soccer aggregate history yet. Development environments can
already contain finalized matches and merges, however, so migration 047 must not assume a clean
database.

Before installing the replacement merge RPC, perform a conservative repair:

1. Find team-scope `game_participants` rows with null `source_player_id` and a UUID
   `client_player_id`.
2. Follow `player_merge_audit.duplicate_player_id -> survivor_player_id` recursively to the current
   surviving player.
3. Restore the link only when the final survivor still exists and belongs to the participant
   game's team.
4. Never recover from display name, jersey number, snapshot prose, or an unaudited UUID.
5. Leave unprovable rows unresolved so SOC-6C reports them truthfully.

Add `supabase/scripts/audit_soccer_participant_sources_pre_047.sql` to report repairable,
already-resolved, intentionally unresolved, and unprovable rows before the operator applies 047.
Migration 047 should report repaired and remaining-unresolved counts with SQL notices.

### Publication-to-aggregate flow

```text
authorized RPC page
  -> parse metadata, canonical snapshot, and stable-player map
  -> create isolated base GameState for the snapshot
  -> rebuild with gameEventRegistry + gameEventProjectors
  -> require healthy completed soccer projection
  -> derive match player rows, clean sheets, team result, and For/Against totals
  -> replace match-local player ids with source_player_id
  -> exclude and count unresolved participant contributions
  -> combine raw values by stable player and scope
  -> derive percentages from combined numerators/denominators
  -> publish complete or explicitly partial read model
```

PostgreSQL selects authorized canonical sources. TypeScript remains the only soccer projection and
aggregate authority.

## 6. Legacy Stat Compatibility

Compatibility aliases are one-way reads into the canonical `soc_*` vocabulary:

- exact legacy equivalents map directly;
- legacy total assists map only to `soc_ast`, not primary or secondary assists;
- a legacy generic tackle maps only to `soc_tkl_att`, not tackles won or lost;
- no alias fabricates a numerator, denominator, rate, appearance, minute, or clean sheet.

The exact first compatibility table is:

| Legacy id | Canonical read id |
|---|---|
| `s_goal` | `soc_goal` |
| `s_ast` | `soc_ast` |
| `s_shot` | `soc_shot` |
| `sot` | `soc_sot` |
| `s_tackle` | `soc_tkl_att` |
| `s_int` | `soc_int` |
| `clearance` | `soc_clear` |
| `foul` | `soc_foul_committed` |
| `yellow` | `soc_yellow` |
| `red_card` | `soc_red` |
| `s_sv` | `soc_gk_save` |
| `s_ga` | `soc_gk_ga` |

Do not write aliases back into canonical snapshots. Keep the compatibility layer until a separate
data-audit and migration plan explicitly removes it.

## 7. Route Experience

Reuse the existing aggregate route URLs and navigation context. Soccer selects a soccer-specific
read model and presentation without changing basketball or other legacy sport behavior.

- Use category tabs and compact sortable tables with roughly three to six columns per category.
- The soccer Leaderboard opens on Attack and sorts by Goals, then total Assists, Shots on Target,
  Minutes, and player name.
- Team Stats uses Overview, Players, and Games sections.
- Tournament Stats uses the same Overview, Players, and Games structure within its tournament
  scope.
- Player and Career pages always show Participation, hide other all-zero categories, preserve
  aggregate rates, and retain their game/season history.
- Preserve existing `sport`, `seasonId`, `teamId`, `tournamentId`, `playerId`, and `from`
  navigation parameters and back behavior.
- Use distinct empty/problem states for no completed canonical matches, no resolved players, no
  values in the selected category, inaccessible scope, transport failure, and partial canonical
  data.

## 8. Confirmed Decisions

| Decision | Answer |
|---|---|
| Delivery size | Four focused slices: contract/engine, transport, team scopes, player scopes/hardening |
| First-release catalog | Every implemented canonical player stat |
| Assist display | Combined assists primary; primary/secondary available in detail |
| Playing-time display | Raw seconds formatted as `MM:SS` or `H:MM:SS` |
| Player games played | Appearance matches only; starts separate |
| Shared clean sheets | One clean-sheet appearance for every qualifying goalkeeper |
| Aggregate rates | All four reviewed rates from combined raw values |
| Zero-appearance rows | Active roster plus historical contributors; show `0 APP` |
| Team result summary | M, W-D-L, GF, GA, GD, and team clean sheets; no standings |
| Team For/Against | Compact eight-stat comparison |
| Score adjustments | Included in official results, never converted to player credit |
| Unresolved identities | Manager-only counts, excluded contributions, and affected-game links |
| Diagnostic authorization | Owner/admin detail for managed teams; generic notice otherwise |
| Refresh | Route entry, manual Refresh, and window focus; no polling |
| Empty states | Distinct source, identity, filter, access, transport, and partial states |
| Clean-sheet id | Read-model `soc_cs`; rates remain derived formulas |
| RPC boundaries | Scope publications plus stable-player publications |
| Pagination | `(finalized_at, publication_id)` keyset; 20 default, 50 maximum |
| RPC payload | Game metadata, canonical snapshot, and stable-player mapping |
| Page loading | Drain all pages before publishing totals; retry on transport failure |
| Request lifecycle | Abort stale loads; newest request alone may publish |
| Client cache | In-flight deduplication only; no completed-result persistence |
| Instrumentation | Structured transport/projection/quality metrics |
| Projection work | Deterministic cooperative batches before worker/cache complexity |
| Season visibility | Aggregate readable teams only without leaking inaccessible-team metadata |
| Personal cloud games | Summary-only; excluded from cross-game aggregates |
| Legacy aliases | Conservative one-way mapping with no inferred stat detail |
| Malformed publication | Visible partial result; manager diagnostics and affected-game links |
| Wide stat catalog | Category tabs with compact sortable tables |
| Leaderboard default | Attack, sorted Goals then AST, SOT, Minutes, name |
| Team/tournament layout | Overview, Players, and Games |
| Player/career sections | Participation always; hide other all-zero categories |
| Performance fixture | 50 matches, about 10,000 events, and about 10 MB payload |
| Missing migration | Explicit backend-update state; never fall back to soccer `game_stats` |
| Player merge behavior | Current `source_player_id` moves credit to the surviving player |
| Verification | Engine, transport, routes, role matrix, and basketball regression |

## 9. Aggregate Read Models

Keep projection and aggregation independent from React.

```text
SoccerCanonicalAggregateSource
SoccerAggregateMatch
SoccerAggregatePlayer
SoccerAggregateTeamResult
SoccerAggregateForAgainst
SoccerAggregateExclusion
SoccerAggregateMetrics
SoccerAggregateResult
```

`SoccerAggregateResult` includes:

- scope identity and readable team metadata;
- included match count and newest/oldest match dates;
- player rows keyed only by stable cloud player id;
- team result totals and For/Against totals;
- game rows for existing history links;
- unresolved and malformed exclusions;
- `complete | partial` quality;
- transport/projection metrics.

Use integer raw values throughout. Duration formatting and percentages happen at presentation time.
Sorting uses numeric raw values, then the reviewed deterministic tie-breakers.

### Result derivation

- Match result uses final canonical tracked/opponent score, including score adjustments.
- Win/draw/loss is from the tracked team's perspective.
- Team clean sheet derives from the completed normal-match score.
- Player clean sheet reuses SOC-6B eligibility; both `credited` and `shared` add one `soc_cs`.
- Own goals remain `soc_own_goal`; they affect the official team score but never `soc_goal`.
- Team advanced attribution diagnostics are retained only in quality/debug data.
- A publication contributes once even when more than one participant resolves to the requested
  player filter; duplicate RPC rows are forbidden.
- Current active roster rows are unioned with historical contributors for team/season display.
- An active roster player with no included appearance receives a zero-valued row.

## 10. Client Transport And State

Add a typed loader that accepts an `AbortSignal`, an `onProgress` callback, and one scope. It:

1. requests and validates a page;
2. records network and payload metrics;
3. appends unseen publication ids;
4. follows `nextCursor`;
5. yields between deterministic projection batches;
6. publishes only after source pagination finishes;
7. returns a partial result only for isolated malformed publications;
8. throws a typed transport/capability/access error for RPC failures.

Use a module-level in-flight map keyed by serialized scope/cursor inputs. Multiple consumers may
share one promise, but aborting one consumer must not cancel another active consumer. Completed
results leave the map immediately and are not cached.

Pages reload on mount, manual Refresh, and a transition back to visible/focused. Guard against
duplicate focus loads while one identical request is active.

Missing-function/PostgREST schema-cache errors become `backend_update_required`. Do not route
soccer through legacy resolved-stat RPCs or `game_stats`.

## 11. Component And File Boundaries

Expected core additions:

```text
src/lib/soccer/aggregateStats.ts
src/lib/soccer/aggregateProjection.ts
src/lib/soccer/aggregateTransport.ts
src/lib/soccer/aggregateStats.test.ts
src/lib/soccer/aggregateProjection.test.ts
src/lib/soccer/aggregateTransport.test.ts
src/components/soccer-aggregates/SoccerAggregateStatus.tsx
src/components/soccer-aggregates/SoccerCategoryTabs.tsx
src/components/soccer-aggregates/SoccerPlayerAggregateTable.tsx
src/components/soccer-aggregates/SoccerTeamAggregateOverview.tsx
src/components/soccer-aggregates/SoccerAggregateGameList.tsx
supabase/migrations/047_soccer_canonical_aggregate_sources.sql
supabase/scripts/audit_soccer_participant_sources_pre_047.sql
src/lib/soccer/migration047.test.ts
```

Likely integration points:

```text
src/config/sports.ts
src/lib/soccer/index.ts
src/pages/Leaderboard.tsx
src/pages/TeamStats.tsx
src/pages/TournamentStats.tsx
src/pages/PlayerProfile.tsx
src/pages/CareerStats.tsx
docs/REGRESSION_TESTING.md
docs/AGENT_CODEBASE_OVERVIEW.md
README.md
AGENTS.md
```

Prefer a small route-level soccer branch that composes shared soccer aggregate components. Do not
rewrite the legacy aggregate implementations or make one component conditionally understand every
sport.

## 12. Detailed Delivery Slices

### SOC-6C1 - Canonical stat contract and aggregate engine

Scope:

- replace the legacy Soccer `SportConfig` catalog with the exact canonical ids;
- add stat metadata, category definitions, aliases, duration/rate formatting, and deterministic
  sorting;
- add pure source-to-match and match-to-scope aggregation;
- reuse canonical projection and SOC-6B clean-sheet rules without React or Supabase;
- model healthy, unresolved, abandoned, shootout, adjusted-score, malformed, and merged-player
  fixtures;
- export stable read models through `src/lib/soccer/index.ts`.

Acceptance:

- every implemented normal-match player stat aggregates under one canonical id;
- rates use combined values;
- DNP does not increment appearances;
- shared clean sheets grant one credit per qualifier;
- unresolved players never merge;
- abandoned/shootout sources do not leak into ordinary totals;
- basketball config/tests remain unchanged.

Implementation:

- `src/lib/soccer/aggregateStats.ts` owns the exact canonical catalog, conservative legacy
  read aliases, category metadata, duration/rate formatting, and deterministic player ordering.
- `src/lib/soccer/aggregateProjection.ts` rebuilds each isolated canonical snapshot with the
  existing projector, derives normal-match player/team read models, and combines raw values by
  stable cloud player id before calculating rates.
- Unresolved participant instances remain match-scoped exclusions, abandoned and malformed
  sources fail visibly, exact duplicate publications deduplicate, and conflicting duplicate
  fingerprints produce partial quality.
- Source management authority is retained on exclusions so later UI work can show detailed
  diagnostics only for teams the viewer manages.
- Focused fixtures cover canonical config, aliases, formatting, adjusted official scores,
  player attribution, goalkeeper substitution/shared clean sheets, merged stable identities,
  zero-appearance roster rows, unresolved identities, malformed/abandoned sources, and duplicate
  publications.

### SOC-6C2 - Paginated canonical source transport

Scope:

- add migration 047 and its grants/security-definer safeguards;
- add the pre-047 source audit and audited-merge-lineage repair;
- add both RPC parsers and full-pagination loaders;
- extend player merge to remount `game_participants.source_player_id`, then use the current mapping
  so player merges take effect;
- add cancellation, in-flight deduplication, progress, capability errors, and metrics;
- profile the reviewed 50-match fixture and record baseline results in this plan or regression docs.

Acceptance:

- static migration contract tests confirm the intended function signatures, predicates, ordering,
  grants, merge remount statement, and conservative repair guards are present;
- TypeScript tests prove response parsing, pagination/cursor behavior, cancellation, deduplication,
  metrics, projection, and partial/error handling against mocked RPC responses;
- manual Supabase verification proves the database behavior listed below;
- only readable active completed publications are returned;
- scope and player cursors are stable with equal timestamps;
- max page size and malformed cursors are rejected;
- season RPC does not leak inaccessible teams;
- player RPC uses the stable-player index and returns no duplicate publications;
- a new player merge preserves finalized soccer source links before deleting the duplicate;
- an audited historical merge repairs its null source link, while an unprovable null remains
  unresolved;
- unavailable migration never falls back to unverified totals;
- reference projection is under two seconds and cooperative batches remain under 100 ms on the
  recorded development machine; hosted network time is measured separately, not asserted in CI.

The RLS, keyset, historical repair, and merge assertions in this acceptance list are
manual/integration-verified database behavior. Passing `migration047.test.ts` alone does not prove
them.

### SOC-6C3 - Season, team, and tournament destinations

Scope:

- add soccer Leaderboard category tabs and Goals-first sorting;
- add Team Stats Overview/Players/Games;
- add Tournament Stats Overview/Players/Games;
- include zero-appearance active roster rows and historical contributors;
- add complete loading progress, Refresh, focus reload, empty/access/error/partial states;
- preserve query parameters and existing navigation;
- keep non-soccer paths on their current RPCs and components.

Acceptance:

- all three scopes use only canonical soccer sources;
- team results and compact For/Against totals match fixture projections;
- season results include only readable teams and label that boundary;
- managers see only diagnostics for teams they manage;
- scorers/viewers see generic quality notices;
- mobile category tables remain readable without a single all-stat grid.

### SOC-6C4 - Player, career, and hardening

Scope:

- add canonical Player Profile and Career Stats loading;
- always show Participation and hide other all-zero categories;
- preserve season/game history and summary links;
- verify merged-player credit follows current stable identity;
- complete the full role, route, malformed-source, capability, and basketball regression matrix;
- update README, agent docs, and roadmap status.

Acceptance:

- team-filtered player, season player, and career scopes agree on shared publications;
- player/career routes cannot broaden game visibility;
- no personal-scope, abandoned, invalidated, unresolved, or shootout totals enter player history;
- all five destinations agree on canonical stat ids and formulas;
- CI and the SOC-6C manual matrix pass.

## 13. Verification Matrix

### Automated

Repository CI has no PostgreSQL/pgTAP runtime. `migration047.test.ts` is therefore a static SQL
contract test: it can prove that required clauses are present in the migration text, but not that
PostgreSQL executes their RLS, cursor, repair, or transaction behavior correctly. Behavioral proof
for those items belongs to the manual Supabase matrix below.

- canonical id uniqueness, category membership, aliases, and no legacy ids in Soccer config;
- exact formatting for seconds above/below one hour;
- appearance/start/DNP and current-roster-zero rows;
- primary/secondary/total assists without double counting;
- goals, own goals, adjustments, and W-D-L;
- all four combined-rate formulas and zero denominators;
- sole/shared/unavailable/abandoned clean-sheet cases;
- unresolved participants with same name/number remain distinct and excluded;
- current stable-player mapping combines merged-player history;
- malformed publication produces explicit partial quality;
- duplicate publication ids are rejected/deduplicated deterministically;
- cursor ties, final page, empty page, max limit, cancellation, stale load, focus dedupe;
- capability, access, transport, and malformed payload errors;
- migration 047 SQL text contains the reviewed signatures, filters, ordering, grants, role checks,
  audited repair guards, and merge remount;
- Leaderboard, Team, Tournament, Player, and Career route read-model integration;
- existing basketball aggregate tests and production build.

### Manual Supabase and browser

- owner/admin/scorer/viewer on one team;
- mixed roles across multiple teams in one season;
- inaccessible team in an otherwise visible season;
- tournament and non-tournament completed games;
- active publication invalidated by reopen while an aggregate page is open;
- refinalized replacement publication;
- player merge after finalization;
- pre-047 audit against an already-null post-merge source link, then apply 047 and confirm the
  audited link is repaired;
- pre-047 audit with an unprovable null and confirm 047 leaves it unresolved;
- unresolved participant then reopen/resolve/refinalize;
- missing migration 047 environment;
- 50-match performance fixture with progress and cancellation;
- mobile category navigation and tables;
- basketball Season, Team, Tournament, Player, and Career paths.

Do not make wall-clock timing a CI assertion. Record machine/browser, fixture size, payload bytes,
event count, projection time, longest cooperative batch, network time, and total time.

## 14. Rollout

1. Merge this plan.
2. Implement SOC-6C1 with no backend dependency.
3. Implement SOC-6C2 and have the operator run the pre-047 source audit.
4. Apply migration 047, review its repair notices, and rerun the audit.
5. Manually verify RLS, equal-timestamp pagination, historical repair, and a new merge transaction.
6. Verify the capability check in both migrated and unmigrated environments.
7. Implement SOC-6C3.
8. Implement SOC-6C4.
9. Keep Soccer development-only through SOC-6C; production enablement remains SOC-6E.

Every implementation PR must be independently buildable. C1 may ship before migration 047. C2
must expose a truthful backend-update state before any route begins using the new RPCs. C3/C4 must
not affect non-soccer aggregate sources.

## 15. Deferred And Non-Goals

- league standings, points, rankings, and competition tiebreakers;
- per-90 and per-standard-match rates;
- season/career shootout statistics;
- name/jersey-based unresolved identity matching;
- account-level personal-game aggregates;
- persisted client aggregate caches;
- Realtime aggregate invalidation;
- Web Worker projection before measurement requires it;
- server/materialized soccer totals;
- writing canonical soccer totals to `game_stats`;
- broad aggregate-page reskin;
- basketball event-model migration.

## 16. Q&A Resolution

All focused SOC-6C planning questions are resolved. Implementation should not reopen these product
decisions unless code discovery proves a stated contract impossible or unsafe.
