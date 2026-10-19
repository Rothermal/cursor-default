# Plan: BSB-7 Baseball Aggregates, Settings and Release

Status: **Product scope approved, execution plan ready for independent review**
(2026-10-19). The owner approved all 23 recommendations, Q1-Q23. The engineering
contracts and four workstreams below are proposed implementation design for review,
not additional owner answers or shipped behavior. After review, this is the owning
execution plan; there is no remaining product-Q&A prerequisite.

This documentation change implements nothing, applies no migration and changes no
release flag. Migration identifiers are assigned during implementation, not here.
The owner manually applies reviewed migrations after merge. Independent review,
implementation verification and live signoff must be recorded separately.

Direction: [BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) and
[shared product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md). Dependencies:
[BSB-6 lifecycle](PLAN_BSB_6_CLOUD_LIFECYCLE.md) and its
[regression record](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md).

## 1. Baseline and Scope

- BSB-6A/#489 and BSB-6B1/#492 merged/deployed; recorder authority, finalization
  and reopen merged in #495; BSB-6C cloud Summary merged in #496.
- The owner reports migrations 076-078 applied. The full BSB-6 live matrix remains
  pending independently of BSB-7. Source analysis and simulated checks are not live
  Supabase/RLS, two-device, physical-mobile or installed-PWA evidence.
- Team settings v1 already ship through 071. Personal settings are new here.
  Current Baseball remains `opt_in` until the BSB-7D implementation cutover.
- Scope: canonical aggregates and explicit personal identity links; five stats
  destinations and separate Legacy Totals; personal rules/device capture defaults;
  event-only creation, read-only legacy retirement and release evidence.
- Preserve independent streams, frozen setup, event identities, account boundaries,
  unsynced facts, exports, authorized existing transports and historical event access.
  Baseball remains clockless; no event schema, earned-run reconstruction, automatic
  pitcher decisions, new player-merge UI or general identity engine is introduced.

## 2. Approved Decision Ledger

All entries below were approved on 2026-10-19. Later sections specify their
implementation and acceptance contracts; rejected alternatives are not retained.

- **Q1 - Official sources:** Active canonical publications only; eligible outcomes
  are `completed`, `run_rule`, `time_limit`, including ties. Forfeit, suspended,
  abandoned, unfinalized, unsynced and local recordings do not contribute to new
  official event totals. Excluded games remain reviewable.
- **Q2 - Historical stats:** Preserve reachable, separately labelled stat-grid totals;
  never silently discard them or mix them into event totals. Q19 settles presentation.
- **Q3 - GP:** Count actual batting, defense, pitching or running appearance,
  including pinch/courtesy runners, not unused selected bench. Replay participation,
  including scoreless courtesy runners; bare `appearedIds` is insufficient.
- **Q4 - Personal history:** Support Profile/Career through explicit stable cloud
  player links. Never infer links from name, jersey or UUID shape; opponents never
  become permanent players. Q9-Q12 define the personal-linking workflow.
- **Q5 - Variants:** Separate Baseball, fastpitch and slowpitch totals/rankings,
  selectable by the user; never blend variants.
- **Q6 - Rates/bases:** Pool counting totals within a variant. Keep ERA and
  K-per-regulation-length in frozen `scheduledInnings` buckets, not a mixed-base
  value. Shortened actual play does not change that basis. Recompute pooled rates
  from raw numerators/denominators; zero denominators are unavailable, not zero.
- **Q7 - Pitch coverage:** Retain ordinary batting/pitching/fielding totals.
  Pitch counts/pitches seen are lower bounds only for contributors affected by
  incomplete Quick PA detail. Pitch percentages use complete pitcher-game subsets
  with coverage, not estimated totals.
- **Q8 - Decisions:** Sum explicit, valid, current-ending-epoch W/L/SV/HLD only.
  Label missing/review-needed coverage; suggestions are never awards. Explicit
  reviewed-empty/none is distinguishable from an absent decision event.
- **Q9 - Selection:** Use creator/guardian-authorized My Players with an explicit
  Create Player action and server checks. No implicit creation/guardianship or
  team-viewer bypass. Team source-team rules remain unchanged.
- **Q10 - Unlinked personal play:** Local participants may remain unlinked, including
  in cloud recordings. Tracking/Summary work; label missing player-history links.
  Link explicitly online. Only unlinked contributions miss stable-player totals;
  other valid linked contributors still count. Offline play needs no cloud identity.
- **Q11 - Historical personal linking:** Offer reviewed per-participant links for
  new and old personal recordings. Link before publication when nonfinal; canonical
  finals require authorized reasoned Reopen, reviewed linking and republication.
  Do not rewrite frozen setup, original event identities or active publications.
- **Q12 - Missing versus invalid:** Keep valid game/team totals and visible unlinked
  coverage; exclude missing/deleted identities from stable-player totals/rankings
  until validly linked. No name-based transfer. Invalid existing identity or corrupt
  sources fail closed, not as anonymous partial totals. Team/S22 recovery remains.
- **Q13 - Personal rules:** Save profile/version plus the five existing team override
  fields: scheduled innings, batting format, extra hitters, run rules, pitch-count
  limit. Other rules remain match-editable; do not expand defaults to every rule.
- **Q14 - Authority:** Personal: built-in -> personal -> match. Team: built-in ->
  team -> match, never personal fallback. Missing team settings use team baseline;
  unreadable team settings fail visibly. Lineup defaults remain team-scoped.
- **Q15 - Capture defaults:** Pitch-location and batted-ball-location defaults stay
  device-local and seed new games only. Current game preferences remain editable
  and persisted; later defaults/sign-in never rewrite existing matches.
- **Q16 - Settings sync:** Account-scoped offline edits queue revision-checked saves;
  conflicts require Use Cloud / Keep This Device. Signed-out defaults stay local.
  Account switches isolate pending edits; opening settings is not an edit.
- **Q17 - Views/ranking:** Compact Batting/Baserunning, Pitching and Fielding views.
  Leaderboard opens on Batting, hits first; metric selection remains available.
  GP alone does not qualify a pitching/fielding-only player for a batting rate.
- **Q18 - Samples:** Show valid rates with denominator/sample size; counting stats
  rank initially, rate sorting keeps samples visible. No invented qualification
  badge/threshold; configurable minimum samples are deferred. Null is not ranked zero.
- **Q19 - Legacy presentation:** Explicit Event Totals / Legacy Totals selector
  where history exists. Separate definitions/sources, no silent zero-result fallback.
  This is a read-only source choice, not a tracker-creation mode.
- **Q20 - History scopes:** Team/season/tournament stay team-scoped. Profile separates
  selected team-season and Personal; Career combines only authorized eligible history
  within a variant, with team-season/Personal segments and filters, not all recordings.
- **Q21 - Final cutover:** At BSB-7D all new Baseball games use events and the opt-in
  toggle is removed. All aggregate games, including unfinished/parked, become read-only
  summaries. Preserve facts, exports and authorized existing-data transport; no
  conversion, auto-finalize, old-tracker fallback or loss of valid event access.
- **Q22 - Live timing:** Owner-only post-deployment validation is approved operationally.
  Actual Supabase/RLS, two-device finalize/reopen/republish, mobile and PWA checks stay
  pending until observed. Broader rollout requires the full matrix; BSB-6 is not
  declared exited. This is not a new owner ACL or automatic owner-count enforcement.
- **Q23 - Compatibility:** Missing new aggregate/settings/link support blocks only
  its affected feature/operation, with explicit update/retry state. Preserve healthy
  local play and supported contract-2/078 cloud behavior; no false acknowledgement,
  dropped selected link, legacy write fallback or silent defaults overwrite.
  The owner applies migrations manually after review/merge.

## 3. Source, Transport and Access Contracts

### Canonical and legacy authority

Extend the latest private paging body in
[075](../supabase/migrations/075_hockey_aggregate_sources.sql), not the older 060
body. Add only fixed Baseball wrappers, eligibility and personal-map handling.
Preserve Soccer/Basketball/Hockey authorization, completion, cursor, scope/personal
rules and grants, demonstrated by bounded body comparisons and role tests.
Keep default page size 20, range 1..50 and paired `(finalized_at, id)` keysets.
Baseball aggregate eligibility must not narrow BSB-6 finalization eligibility.

Parse canonical schema 1 through [finalization.ts](../src/lib/baseball/finalization.ts)
and inspect/freshly replay via [summary.ts](../src/lib/baseball/summary.ts).
Never trust cached projection, use a nonfinal primary as official totals, or blend
recorders. Reopen invalidates the contribution until a new eligible publication.
Missing/corrupt pins, snapshots or invalid existing identities isolate the source
with diagnostics/partial quality; do not publish a plausible partial game score.

Legacy Totals accept stored Baseball sport or verified Baseball team-season
provenance only. Conflicting metadata/event authority is excluded; ambiguous
null-sport personal history remains reviewable/exportable, not guessed/backfilled.
Preserve resolved corrections and existing final-only eligibility; unfinished legacy
games never become career contributions by retirement. Do not copy Basketball 060
backfill or assume legacy career SQL 028's team joins support personal history.
Retain authorized finalized legacy contributions separately from event definitions.

### Loads and cancellation

Drain all keyset pages even when early pages contain no selected variant. Healthy
other variants are filtered, not malformed; unknown variants are isolated with a
diagnostic. Validate exact envelopes and deduplicate by game/publication identity;
colliding active publications cannot double-count. Include pinned-map fingerprint
in personal source identity and consistency checks.

Shared request keys include account/auth generation and authorized scope/source;
do not blindly clone Hockey's account-less shared key. Guard A -> B -> A, sign-out,
unmount, team/scope/variant/source changes and refresh generations before UI updates
or writes. One consumer cancelling must not cancel another valid subscriber.
Use in-flight sharing, bounded progress/quality reporting and explicit refresh;
never serve stale-account completed results as an authoritative cache.
Remote Summary/aggregate reads never hydrate GameContext, replace the active slot
or mutate local storage. Inspection does not grant correction rights.

Team contributions retain accepted-team scorer/viewer read permissions. Personal
history additionally requires both existing game-read permission and target-player
creator/guardian authority; guardianship alone does not expose another creator's
personal game. An unscoped Career reader unions these independently authorized
sources without widening either ACL.

## 4. Explicit Personal Identity Contract

This is proposed engineering design for Q4/Q9-Q12, not a shipped mechanism.
Use existing `game_participants.source_player_id` as the confirmed operational
personal link. Keep personal binder payload source ids null: the latest 055 binder's
`ON CONFLICT DO NOTHING` preserves an already confirmed source. Do not alter
051/055/067 team membership checks or route team games through personal linking.

Local explicit intent lives outside immutable setup/events, keyed by account,
local game and participant; never derive it from UUID shape. Apply online after
binding, with visible pending/error. Event-sync success is not link acknowledgement;
missing capability retains intent. No general offline identity queue is required.

### Fixed write and transactional boundary

Proposed fixed RPC: `link_baseball_personal_participant`, accepting game id,
client participant id, target player id, expected map fingerprint, expected publication
id, reason and operation id. Exact names may follow local conventions; the contract is:

- Active account, Baseball event personal game created by caller, no team/season;
  recorder derives from `auth.uid()`, never a supplied recorder identity.
- Match immutable tracked setup and participant client identities; reject opponent,
  placeholder, foreign or ambiguous rows. Target must be caller-created or currently
  guardian-authorized. Team visibility/admin status is not personal identity permission.
- Permit null -> target and same-target idempotent retries only; reject duplicate
  target within a game. Replacement/unlink is outside this workstream.
- Lock the game using publication/reopen's protocol; recheck current permissions,
  compare-and-swap expectations, write link and receipt/audit atomically.
  Reusing an operation id with a different payload fails.
- For a canonical final, require reason and exact active publication, then existing
  Reopen + reviewed link + receipt/audit in one transaction; any failure rolls all
  back. Return a reopen handoff only for the caller's own recording.
- Do not automatically republish. After a successful link transaction, interruption
  of subsequent end/sync/republication leaves the game nonfinal and excluded until
  completion. Failure of the atomic Reopen-link transaction restores the original
  final state.

One bounded receipt/audit store may serve idempotency and audit; avoid a general
identity framework. No new merge UI or additional team write permission is implied.

### Publication-pinned identity

Add a private, RLS-protected Baseball-personal publication sidecar, keyed by
publication FK with schema, primary, complete `participantId -> sourceId | null`
map and fingerprint. An INSERT hook creates it inside the existing finalization
transaction, including old-client calls. Freeze nulls too; retain invalidated pins.
Do not change canonical schema 1 or event payloads. Pin UUID values have no
player-FK cascade or automatic merge rewrite.

Build entries from canonical setup and server-confirmed links. Bootstrap historical
personal publications as all-null only after proving prior personal source ids were
null; unexpected non-null history is invalid/review-needed, never retroactive credit.
Both the 075 player filter and returned participant map must use the pinned personal
map, not current live rows. Missing/corrupt pins never fall back to a live mapper.

Keep team/sibling mapping unchanged. For immutable personal pins only, resolve
verified existing `player_merge_audit` lineage to an authorized survivor; unknown,
ambiguous or cyclic lineage is invalid, not anonymous. Historical confirmed attribution
does not grant future player/game access.

Add a fixed new finalization variant that compares the reviewed map fingerprint
under the same game lock before calling existing finalization. Keep the old wrapper
unchanged; the pin hook covers both. Idempotent publication retry reuses its original
pin, never re-pins. Test one-hop/chain/ambiguous merges and link/finalize/reopen races.
Team roster/S22 repair remains its existing workstream, not this personal RPC.

## 5. Aggregate Calculation and Quality Contract

Preserve the full existing batting, pitching and fielding counter catalog in
[stats.ts](../src/lib/baseball/stats.ts). Add replay-derived GP, role appearances,
starts, explicit decisions and rates; never persist these into `game_stats`.
Do not add unapproved GF/CG/shutout modules, player LOB inference, automatic W/L/SV
or earned-run reconstruction.

After `game_started`, entering starting batting/defensive roles counts as appearance;
valid substitute entries include scoreless courtesy runners. Pregame draft/selected
bench alone does not count. Pitcher role/start comes from replayed defense position
`'1'` or actual pitching entry, not roster position or a positive-outs requirement.
Keep historical source players absent from today's roster. Active-roster zero rows
may display GP 0 and rates null without inventing appearances.

Variant and basis come from frozen `rulesSnapshot`, never current profiles/team
defaults. Scheduled innings supports 1..15; ERA6/7/9 are examples, not an allow-list.
Sum raw counts within variant; per-basis rates use only that basis's numerator/outs.
Sum outs before formatting IP in scorebook notation; never decimal-sum displayed IP.

| Metric | Derivation from pooled raw counts in the applicable scope |
| --- | --- |
| AVG | H / AB |
| OBP | (H + BB + HBP) / (AB + BB + HBP + SF) |
| SLG / OPS | TB / AB; OPS = OBP + SLG only when both are available |
| ERA / K per basis | 3 * basis * ER / outs; 3 * basis * K / outs, separately per frozen basis |
| WHIP | 3 * (BB + H) / outs |
| TC / FPCT | PO + A + E; (PO + A) / (PO + A + E) |

Every zero denominator returns null/unavailable, never zero or Infinity. IBB is a
subset of BB, not an extra walk added again. Rates are never averages of game rates.
Official team runs include replayed reasoned score adjustments; do not fabricate
player runs to reconcile batting attribution with that score. Team context includes
R/H/E and line-score LOB, not a sum of invented player LOB, plus canonical game history.

### Pitch detail and decisions

Ordinary PA/H/AB and other valid totals survive Quick PA incompleteness. Lower-bound
pitch-count/pitches-seen labels apply only to affected contributors; fully recorded
totals remain exact. Pitch percentages pool raw observations from complete
pitcher-game subsets, with contributing/excluded coverage, never estimated Quick PA
pitch totals. Preserve recorded/unlocated distinction without treating unlocated as
unrecorded.

First-pitch-strike denominator is known first-pitch observations credited to that
pitcher, not blind BF: a pitching change may happen mid-PA, and a profile can start
at 1-1. Derive explicit initial-pitch markers/helper from replay-before-each-event,
with tests for both cases; do not infer first pitch solely from the count.
No new event schema is needed for that read-time derivation.

Only valid current-ending-epoch explicit decisions contribute. Expose absent,
review-needed and explicit reviewed-empty coverage distinctly. Reopen/correction
must not preserve obsolete decisions or auto-award suggestions.
Source corruption/invalid identity excludes the source; a merely missing stable
link preserves valid team totals and linked peers, with unlinked coverage.

## 6. Personal Settings and New-Setup Contract

Use exact three-key personal settings: `settingsSchemaVersion`, `baseProfile`
(profile id/version), and `ruleOverrides`; no lineup ids. Reuse the five fields in
[settings.ts](../src/lib/baseball/settings.ts): `scheduledInnings`,
`battingOrderFormat`, `maxExtraHitters`, `runRules`, `pitchCountLimit`.
Validate the complete effective rules and immutable profile/version. Preserve team
v1 with lineup defaults and existing 071 team CAS behavior unchanged.

Add a fixed account-active personal CAS save surface over existing settings storage.
Use shared `useSportPersonalSettings`/reconciliation patterns, account-scoped local
pending edits, and explicit Use Cloud / Keep This Device. Reject stale revisions;
opening a page/default seeding is not an upload or edit. Signed-out data remains
device-local; auth changes must not flush another account's pending values.

Personal setup resolves built-in -> personal -> match; team resolves built-in ->
team -> match. Wait for source settings/roster authority; missing team values use
team baseline, unreadable values show errors, never personal fallback. Apply defaults
only to fresh setup; explicit recorder edits and frozen started games win.

Device `trackPitchLocation` / `trackBattedBallLocation` defaults remain true,
persist device-locally and seed new games only. Existing game preferences and
gameplay fingerprints are unchanged by defaults, settings sync or sign-in.
Setup Cancel preserves the current game. Commit one reviewed draft rollback-safely;
do not replace/park the active game before source/capability checks settle.

## 7. Capabilities, Cutover and Release Contract

### Independent feature capabilities

Keep release contract 2 / migration 078's exact response shape unchanged, with no
extra feature fields. New aggregate contract 1 and new settings/link capabilities
are separate fixed checks. Follow the exact checker: missing/lower support means
`backend_update_required`; higher means `client_update_required`; malformed,
negative, extra/wrong-key responses mean `invalid_response`. Cache by account/auth
generation; capability success is not a write or completed operation.

Missing support blocks only that aggregate read, settings save, link or reviewed-map
finalization operation. Retain pending edits/intents, explicit errors and retry.
Do not silently drop a selected identity, claim a link saved after event sync,
fall back to aggregate writes or gate ordinary supported cloud/local play.
Review an explicit matrix: pre-BSB-7 and BSB-7 clients against 078-only and new
backends, plus individually missing aggregate/settings/link support. Legacy reads
remain available independently. Migrations are manual owner actions after merge.

### Event-only creation and legacy retirement

At BSB-7D remove new-game opt-in/Legacy choices, not unrelated sport-discovery or
capture controls. Audit dashboard, Team Info, direct `/setup?sport=baseball` with
absent/stale `events`, team-only links, `/players`, `/checkout`, `/game`,
stale drafts, imports, parked resume, Cloud Games and Game Info.
Resolve a Baseball team's sport independently of an unrelated active game. Failed,
unsupported or mismatched Baseball/team authority must not fall through to Soccer,
legacy capture or an unintended game creation. Cancel changes nothing; final commit
must not introduce a last-moment destructive Replace.

All aggregate Baseball records become read-only for every role/status, including
unfinished, parked and offline games. Guard handlers, not just buttons: generic
Summary corrections, primary/finalization, Back to game and direct capture paths
must not revive writes. Preserve local facts, exports and authorized transport of
already-recorded data; keep the aggregate cloud capability needed to drain dirty
history. Do not auto-finalize, convert, clear unsynced metadata or treat corrupt
event authority as legacy. Existing valid clockless event games retain their paths.

Rollback disables new Baseball creation at the cutover policy without hiding
existing events/safe old sync or restoring the grid. A generic released -> opt_in
rollback is unsafe if it revives legacy creation. Cached pre-cutover PWA clients
remain old clients; do not claim their UI is retroactively removed. Use explicit
refresh/build checks and guarded updates, never forced reload that loses dirty games.

### Operational release boundary

Event-only creation, whole-sport discovery and app/team access are separate policies.
Q22 permits operational owner-only post-deployment validation; it adds no owner ACL,
automatic user-count enforcement, app access/invite expansion or broader release
approval. Preserve current app access and team roles. The complete live matrix is
mandatory before access broadens; unexecuted checks remain pending.

## 8. Four Delivery Workstreams

These are bounded execution proposals, not additional product questions. 7A precedes
7B; 7C uses the reviewed foundation; 7D depends on 7A-7C and owns the only cutover.
Keep current opt-in behavior through 7A-7C. Use each workstream's acceptance evidence
in its owning regression record when code lands, with actual commands/results.

### BSB-7A - Canonical Foundation and Identity

Deliver fixed paging/eligibility, pinned personal maps and reviewed linking,
capability surfaces, pure aggregate engine and transport. Include narrow authorized
team-tournament validation in the transport contract, not a general setup redesign.
Its interfaces are source envelopes, explicit/pinned identity, derived aggregate
result/quality and typed capability errors; UI does not own rules or authorization.
Own the checked online RPC/client link command and persisted-intent interfaces;
no standalone link UI is required in 7A.

Acceptance/evidence required:
- Latest-075 sibling parity, keysets/all-page draining, exact capability parser and
  raw-replay equality on corrected, removed, reopened and republished histories.
- GP/role/start, custom bases/variants, null denominators, integer IP, pitch coverage,
  mid-PA pitching changes/1-1 starts, valid decisions and score-adjustment attribution.
- Personal versus team role matrix, source-map pinning for old/new finalizers,
  null bootstrap refusal, transactional rollback/CAS/idempotency, merge lineage and
  concurrent link/finalize/reopen. Missing versus invalid identity stays distinct.
- Account-generation sharing/cancellation, duplicate/colliding publications,
  malformed-source isolation, and no GameContext/storage writes from remote reads.
- Separate future SQL/role/parity harness plus units; owner applies migration before
  live checks. Source-body assertions alone are not database integration signoff.

If actual implementation makes 7A too large, split server/client delivery at those
interfaces while retaining one reviewed contract and exit condition. Do not invent
microphases or ship player aggregates before their identity dependency is safe.

### BSB-7B - Five Destinations and Separate Legacy Totals

Route Leaderboard, Team Stats, Tournament Stats, Profile and Career before legacy
fallback. Use one authoritative source/variant per view, compact category selection,
hits-first Batting and sample-visible rate sorting. Keep basis, scope, coverage and
source labels coherent across zero/error/partial/refresh states.

Own a creator-only personal Game Info Review player links sheet, using the existing
My Players pool and server gates. Support nonfinal linking and final reasoned
Reopen-link followed by explicit republication; Summary remains read-only.
The label is illustrative; this entrypoint and UI ownership are required.

Close the existing tournament source-creation gap: setup/sync currently hardcode
null tournament ids. Add only explicit authorized team-tournament attachment,
preserved through new setup, save/sync and cloud reload, with 7A validation.
Reject cross-team or personal attachment and retain Tournament Stats ownership checks.

Acceptance/evidence required:
- All five views, active-roster GP-0/null-rate rows, historical players, personal versus
  team-season segments, custom basis buckets and canonical Summary history links.
- Event/Legacy selector never blends sources or silently falls back on zero.
  Verify Baseball legacy provenance, final-only resolved corrections and ambiguous
  personal-history review/export without guessed contributions.
- Tournament persistence/authorization, route/back context, stale scope/account
  cancellation, explicit refresh after reopen/republish and safe unhealthy sources.
- Desktop/phone, Light/Dark, keyboard, source/variant transitions and read-only remote
  detail checks. Record simulated browser results separately from live RLS evidence.

### BSB-7C - Personal Rules, Setup and Device Defaults

Deliver exact personal settings/CAS, account-isolated offline reconciliation and
Settings/setup integration. Preserve team v1, source hierarchy, explicit match edits
and new-game-only device capture defaults. Reuse bounded shared hooks/fields.

Own personal new-setup My Players selection and an explicit Create Player action.
Persist account/local-game/participant link intents for online application after
binding, without rewriting old setups. Signed-out/offline unlinked play still works.

Acceptance/evidence required:
- Exact schema/effective-rule parity, stale CAS, offline edits, both conflict choices,
  signed-out defaults, A -> B -> A and missing-feature errors without cloud overwrite.
- Personal/team/missing/unreadable settings, roster settling, recorder edits,
  Cancel/failed commit preserving the active game and historical setup unchanged.
- Both device defaults true for fresh settings, independently editable current games,
  reload persistence and no preference/fingerprint mutation on sign-in or sync.
- SQL authenticated/active-account and cross-account refusals, unchanged team settings,
  plus focused browser accessibility/narrow-screen checks. No new live pass is assumed.

### BSB-7D - Event-Only Cutover and Release Evidence

Only after foundation/destinations/settings readiness, switch every new Baseball
entry to events, remove opt-in creation UI and retire aggregate capture everywhere.
Preserve existing-data transport/export and implement the data-safe rollback policy.

Acceptance/evidence required:
- The complete entrypoint inventory above, unrelated active sports, unsupported/team
  mismatch, stale params/drafts, imports/resume and missing-feature recovery.
- Handler-level read-only legacy checks for every role/status, unfinished/debt-bearing
  records, unchanged export/facts/authorized sync and no legacy/corrupt-event fallback.
- Existing event/local/cloud/Summary paths, clockless replay, sibling sports, app access
  and team permissions unchanged; exact old/new client/backend/PWA matrix.
- Guarded PWA update, offline/reconnect, phone layouts, rollback and active-game safety.
  Record automated gates and browser fixtures with exact candidate/build identity.
- Owner-only post-deployment actual Supabase/RLS, two-device finalize/reopen/republish,
  physical-mobile and installed-PWA checks stay pending until observed. Record any
  failure before broader enablement; do not label the release matrix passed by merge.

## 9. Verification, Security and Handoff

Implementation PRs require focused sport/shared tests plus repository typecheck,
lint, test and build gates appropriate to their blast radius. Record observed
counts/results only. New database behavior also needs a disposable SQL harness for
auth, roles, RLS/grants, CAS, locks and transaction rollback; live PostgREST remains
a separate owner check. No implementation test or live check was run for this plan.

Follow explicit authentication, least-privilege fixed RPC grants and revoked private
core access. Enable RLS on new identity/receipt/pin tables and test cross-account,
team/viewer and direct-write refusals. References:
[database functions](https://supabase.com/docs/guides/database/functions) and
[row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
These links are guidance, not evidence of deployed security.

Fresh independent review must confirm Q1-Q23 coverage, bounded 075 changes,
publication-pin/old-client safety, calculation coverage, personal-versus-team
authorization, tournament attachment, handler-level retirement and rollback.
Unresolved technical adjudication is resolved before its implementation; it is not
a new pending product batch. If design cannot satisfy an approved decision, raise
that conflict explicitly rather than silently weakening the contract.

Delivery status: **plan for review; 7A-7D not implemented by this change**.
Current `opt_in`, exact cloud contract 2/078 and existing access remain unchanged.
BSB-6 and broader-release live evidence remain pending. The parent owns final
validation, Git/PR work and fresh review; this document does not authorize migration
execution, deployment or access expansion by an agent.
