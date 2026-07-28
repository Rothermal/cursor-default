# Plan: SOC-6 Summary and Release

Status: SOC-6A through SOC-6E3 implemented. Soccer is approved as an owner-only opt-in production
sport; post-deployment and broader-release evidence remains tracked in
`REGRESSION_SOC_6E_RELEASE.md`.

## 1. Goal

Turn the development-only soccer workspace into an opt-in supported sport with complete match
review, player aggregates, account-backed defaults, and a release-grade regression boundary.

SOC-6 must preserve the event model established in SOC-1 through SOC-5:

- raw soccer events and locked match setup remain the source of truth;
- finalized cloud review uses the active canonical publication;
- independent recorder streams never blend automatically;
- finalized corrections require audited reopen and republish;
- basketball aggregate sync, summaries, and historical games remain unchanged;
- local-only soccer remains usable without Supabase.

The broader application reskin is not part of SOC-6.

## 2. Current Baseline

SOC-1 through SOC-5D are implemented. The codebase already has:

- deterministic soccer projection for match state, score, player totals, side totals, minutes,
  lineup/role intervals, discipline, and shootouts;
- local parking plus recorder-owned cloud event transport;
- canonical publication, final score derivation, manager finalization, and audited reopen;
- a development-only live tracker and shared authority-aware Overview summary;
- generic basketball-era summary, season, team, player, career, and tournament routes.

Important implementation drift to resolve:

- `src/config/sports.ts` still exposes the old limited soccer stat ids such as `s_goal`;
- the event projector emits the richer canonical `soc_*` stat family;
- generic aggregate RPCs read `game_stats`, while soccer authority lives in canonical event
  publications;
- detailed Players, Timeline, Field, and conditional Shootout review are implemented;
- soccer settings do not yet exist and current app settings are device-local;
- production route and sport-availability gates still reject soccer.

SOC-6 must reconcile these surfaces without copying event-derived totals into an unverified
client-authored authority table.

## 3. Delivery Slices

### SOC-6A: Summary foundation and overview

Detailed plan:
[PLAN_SOC_6A_SUMMARY_FOUNDATION.md](PLAN_SOC_6A_SUMMARY_FOUNDATION.md)

Build the shared soccer summary read model and first production-quality summary surface.

- Add one `SoccerSummary` experience at `/summary`.
- Support current local state and direct cloud loading through `?gameId=`.
- Redirect legacy `/soccer/review` links to the shared summary.
- Resolve authority explicitly:
  - current local recorder state for local/non-final owned work, never a cloud-final local copy;
  - the SOC-5C effective primary for non-final read-only review;
  - active canonical publication for a finalized game.
- Ship an Overview-only shell in 6A while reserving query-safe future tab ids internally.
- Do not show disabled or incomplete Players, Timeline, Field, or Shootout tabs; 6B adds them only
  when their complete views ship.
- Ship Overview with score/result, regulation or extra-time decision context, conditional
  shootout result, side-by-side team totals, and compact leaders.
- Keep the user in the tracker after match end and add an explicit Summary action.
- Keep finalization/reopen access available from the appropriate summary state.

Exit condition: a local ended match, the non-final SOC-5C effective primary, and a canonical final
all open the same truthful Overview with correct edit/read-only behavior and no incomplete tabs.

### SOC-6B: Detailed match review

Detailed plan:
[PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md](PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md)

Complete player, Timeline, field-map, and shootout review.

- Deliver SOC-6B through the detailed plan's 6B1-6B4 slices.
- Expose each new tab only when that tab's complete implementation and regression boundary ship.
- Player table keeps identity, lineup status, role, and minutes fixed while category tabs switch
  Attack, Defense, Discipline, and Goalkeeping columns.
- Include every match participant; unused substitutes display `DNP`.
- Player detail exposes full match totals and role/on-field intervals.
- Derive rates at read time:
  - shot accuracy;
  - goal conversion;
  - tackle win rate;
  - goalkeeper save percentage.
- Derive team and goalkeeper clean-sheet context. Every goalkeeper who played and conceded no
  goal during their own on-field interval receives credit; multiple qualifying keepers are
  labeled as a shared clean sheet.
- The 6B phase Q&A must settle interval boundaries, own-goal treatment, and shootout exclusion
  before clean-sheet derivation is implemented.
- Timeline defaults oldest-first with period headings and family filters.
- Local/current-recorder non-final review reuses revision editing.
- Remote-primary and canonical-final review stay read-only and offer Resume or Reopen actions
  when authorized.
- Field maps show all located event families using side colors and event-specific shapes.
- Filter maps by side, participant, family, and period.
- Normalize attacking direction by default and provide original match orientation as a toggle.
- Keep unlocated events in totals and Timeline, display an unknown-location count, and omit only
  their field marker.
- Keep shootout presentation separate from normal score and player goal totals.

Exit condition: the complete four-view summary plus conditional shootout review works on mobile
for local, primary-cloud, and canonical-final sources.

### SOC-6C: Canonical aggregate projection

Feed existing stat destinations from canonical soccer sources without introducing a second
unverified authority.

- Make `soc_*` the canonical soccer stat-id family in `SportConfig`.
- Add only a narrow compatibility map for pre-release development data using old soccer ids.
- Add RLS-scoped, paginated RPCs that return the active canonical source needed for authorized
  season/team/player/career/tournament projection.
- Instrument publication count, event count, payload bytes, and projection time during 6C; measure
  the paginated client path before proposing any materialized cache.
- Run the existing deterministic TypeScript projector over canonical setup/events and aggregate
  the resulting totals in the client.
- Do not write client-supplied canonical soccer totals into `game_stats`.
- Reuse existing Season, Team, Player, Career, and Tournament route shells with soccer-specific
  categories, sorting, formatting, and empty states.
- Include only completed active canonical publications in aggregates.
- Exclude abandoned matches from first-release aggregates while retaining their summaries.
- Include only participants resolved to stable cloud players in cross-game player totals.
- Surface unresolved-participant exclusion counts to managers.
- Keep shootout statistics game-scoped in the first release.
- Sum raw numerators/denominators before deriving aggregate percentages.
- Defer per-90 and per-standard-match rates.
- Treat an invalidated publication as immediately absent; a replacement publication becomes the
  only aggregate source.

Exit condition: finalized completed soccer matches contribute deterministic player totals to all
existing aggregate destinations, while abandoned, invalidated, unresolved, and shootout data
follow the reviewed exclusion rules.

### SOC-6D: Soccer settings and default hierarchy

Detailed plan:
[PLAN_SOC_6D_SOCCER_SETTINGS.md](PLAN_SOC_6D_SOCCER_SETTINGS.md)

Add grouped soccer configuration without turning every stat into a toggle.

- Add account-synced soccer defaults for authenticated users.
- Keep a local cache and full local-only fallback when Supabase is unavailable.
- Resolve defaults in this order:
  1. built-in app defaults;
  2. personal account defaults;
  3. shared team soccer overrides;
  4. per-match overrides.
- Store personal defaults as a complete configurable profile and team/match layers as sparse
  overrides.
- Snapshot the resolved setup when the user continues from Match Setup. Later settings changes
  never rewrite existing games.
- Configure core rule/display defaults:
  - count-up or countdown display;
  - period count and duration;
  - on-field player count;
  - return substitutions;
  - extra-time and shootout defaults;
  - useful field-orientation preference.
- Keep every implemented core event family available.
- Add optional module toggles only when those advanced modules actually ship.
- Keep display orientation personal while first-period attacking direction remains match-specific.
- Use revision-aware sync and explicit conflict resolution rather than silent last-write-wins.
- Soccer is disabled by default for normal discovery.
- Disabling Soccer blocks new games and removes it from normal sport selection, but existing
  games, summaries, teams, and statistics remain accessible.

Exit condition: account defaults follow a signed-in user across devices, local-only defaults still
work, team/game overrides resolve predictably, and setup snapshots remain immutable.

### SOC-6E: Release hardening and enablement

Remove development gates only after the complete release boundary passes.

- Replace `import.meta.env.DEV` soccer routing with normal sport availability checks.
- Make Soccer opt-in under App settings rather than globally enabled.
- For authenticated cloud creation, verify required soccer backend capabilities before starting a
  new cloud game.
- Continue allowing local-only soccer when Supabase is absent.
- Keep existing historical access when Soccer is disabled.
- Consolidate the full soccer release matrix in `docs/REGRESSION_TESTING.md`.
- Cover mobile layout, local-only play, offline parking, reconnect, multiple simultaneous sports,
  independent recorders, viewer/scorer/manager permissions, conflicts, finalization/reopen,
  summary sources, field maps, settings hierarchy, aggregates, and migration failure states.
- Re-run basketball setup, tracker, court capture, parking, cloud finalization, summary,
  corrections, and aggregate regression paths.
- Deliver responsive functional polish consistent with the current application shell. Do not
  block release on the future application-wide reskin.

Exit condition: CI and the complete manual release matrix pass against an environment with all
required migrations, and production builds expose opt-in Soccer without weakening other sports.

## 4. Authority and Editing Matrix

| Summary source | Display authority | Editing |
|---|---|---|
| Local-only current match | Current healthy local event stream | Current recorder may revise |
| Bound non-final current recorder | Current healthy local stream | Current recorder may revise |
| Locally retained cloud-final binding | Active canonical setup/events via its cloud game id | Read-only; never offer local reopen |
| Non-final remote cloud game | SOC-5C effective primary cloud stream | Read-only; resume owned stream to edit |
| Final cloud game | Active canonical setup/events | Read-only; manager must reopen |
| Reopened cloud game | Live selected primary after publication invalidation | Recorder revision flow resumes |

Local match completion is not canonical finalization. It receives a clearly labeled local summary
and remains editable. If it later binds to cloud, normal sync and canonical finalization are
required before it can enter cloud aggregates.

## 5. Summary Product Contract

- Tabs are `Overview`, `Players`, `Timeline`, and `Field`.
- `Shootout` appears only when applicable.
- Staff/team discipline appears in team comparison and Timeline, never in player statistics.
- Opponent team totals appear when derivable even when individual opponent players are unknown.
- Unknown-location events remain statistically authoritative.
- Rates never display when their denominator is zero.
- Minutes retain second precision in the model and use an appropriate `MM:SS` or
  hours/minutes display for the surface.
- Finalized canonical corrections always require reasoned reopen and a new publication.

## 6. Aggregate Safety Contract

- Active canonical setup/events, not `game_stats`, are soccer aggregate authority.
- RPCs enforce existing game/team read access and expose only active authorized publications.
- Client projection uses the same versioned registry/projector as game review.
- Projection diagnostics exclude that publication from aggregate totals and surface an error;
  they never silently publish partial totals.
- Name or jersey similarity never merges unresolved participants across games.
- Aggregate percentage formulas use combined totals, not averages of per-game percentages.
- Caching is an optimization only and cannot become an independent source of truth.

## 7. Settings and Availability Contract

- Account-backed defaults use a versioned schema and deep-merge missing keys.
- Local settings remain usable offline and without authentication.
- Authenticated writes use revision-aware compare-and-swap; a conflict requires an explicit
  **Use Cloud** or **Keep This Device** choice.
- Shared configuration is team-scoped and owner/admin-managed.
- Personal defaults are complete across configurable fields; team and match layers are sparse
  overrides.
- Per-match overrides are explicit at setup and become part of the immutable match snapshot.
- Disabling Soccer never hides or corrupts historical data.
- A missing backend capability blocks new cloud soccer creation with a useful error, not the
  local workspace or historical read-only access.

## 8. Reviewed Decisions

The SOC-6 Q&A selected the recommended option for all 32 high-level questions:

- five focused implementation slices;
- player aggregates in first release, with standings deferred;
- reopen-before-correction for canonical finals;
- opt-in production availability;
- one local/cloud summary route and four core tabs;
- explicit post-match Summary navigation;
- compact overview with team comparison and leaders;
- category-based player tables including `DNP`;
- read-time rates and shared goalkeeper clean-sheet credit;
- all-family field maps with normalized direction and unknown-location accounting;
- oldest-first review Timeline with authority-aware editing;
- canonical source projection rather than client-authored aggregate rows;
- stable-player-only cross-game totals and canonical `soc_*` ids;
- account-backed defaults with season/game override hierarchy;
- core event families always available;
- historical access after disabling Soccer;
- completed-only first-release aggregates, no shootout season totals, and no per-90 rates;
- selected-primary non-final review with optional other streams;
- truthful editable local summaries before cloud finalization;
- backend capability checks for cloud creation;
- functional polish without a broad reskin;
- automated plus complete manual regression before production enablement.

## 9. Deferred Beyond SOC-6

- Team standings, configurable points, and competition tiebreakers.
- Per-90 and per-standard-match rates.
- Season shootout leaderboards.
- Automatic aggregation of unresolved participants by name or jersey.
- Advanced capture modules listed in SOC-0.
- Collaborative editing of one recorder stream.
- Server/materialized aggregate caches unless measured performance requires them.
- Broader application reskin.
- Basketball migration to the shared event model; see the BKE roadmap.

## 10. Planning Handoff

Each slice receives its own implementation plan and focused Q&A before code changes:

```text
docs/PLAN_SOC_6A_SUMMARY_FOUNDATION.md
docs/PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md
docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md
docs/PLAN_SOC_6D_SOCCER_SETTINGS.md
docs/PLAN_SOC_6E_RELEASE_HARDENING.md
```

Phase planning should settle component boundaries, exact stat tables, RPC payload/pagination,
settings reconciliation, migration numbering, and test fixtures without reopening the reviewed
high-level product decisions.

SOC-6B is implemented through SOC-6B1 player review, SOC-6B2 Timeline review, SOC-6B3 Field
review, and SOC-6B4 Shootout review plus the detailed-summary release boundary.

SOC-6C focused Q&A and detailed implementation planning are complete in
`docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md`. Delivery is split into SOC-6C1 stat contract/engine,
SOC-6C2 source transport, SOC-6C3 team scopes, and SOC-6C4 player scopes/hardening.

SOC-6D is implemented through settings foundation, personal reconciliation, shared team/setup
inheritance, and hardening. SOC-6E focused Q&A and detailed planning are complete in
`docs/PLAN_SOC_6E_RELEASE_HARDENING.md`; delivery is split into SOC-6E1 availability/capability,
SOC-6E2 regression hardening, and SOC-6E3 production enablement.

SOC-6D focused Q&A and detailed implementation planning are complete in
`docs/PLAN_SOC_6D_SOCCER_SETTINGS.md`. Delivery is split into SOC-6D1 schema/resolver/local model,
SOC-6D2 personal settings/sync, SOC-6D3 shared team defaults/setup inheritance, and SOC-6D4
hardening/documentation. SOC-6D1 is implemented with migration 048 and the versioned local/cloud
settings foundation.
