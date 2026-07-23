# Plan: SOC-6A Summary Foundation

Status: Implemented. SOC-6B detailed Players, Timeline, Field, and Shootout views remain next.

Parent roadmap: [PLAN_SOC_6_SUMMARY_AND_RELEASE.md](PLAN_SOC_6_SUMMARY_AND_RELEASE.md)

## 1. Goal

Replace soccer's minimal development-only cloud review with one truthful summary foundation for:

- the current local match;
- a non-final selected cloud primary;
- a finalized canonical publication.

SOC-6A ships the shared route, source-authority loader, responsive shell, and complete Overview.
Players, Timeline, Field, and Shootout become visible only when their complete implementations ship
in SOC-6B.

SOC-6A does not remove production soccer gates, publish aggregates, or add soccer settings.

## 2. Reviewed Product Contract

### Route and source authority

- `/summary` without `gameId` reads the current local soccer `GameState`.
- If that local state is bound to a cloud-final game, its `gameId` becomes the canonical lookup;
  the retained local copy is never editable summary authority.
- `/summary?gameId=<uuid>` reads cloud state without hydrating `GameContext`, activating a parked
  record, or disturbing another active game.
- A non-final cloud request reads the SOC-5C effective primary recorder stream: explicit manager
  selection when present, otherwise the existing creator-preferring provisional default.
- A final cloud request requires a healthy active canonical publication.
- A final game with no healthy active publication fails closed with recovery guidance. It never
  falls back to a live recorder or a stored score-only view.
- Legacy `/soccer/review` preserves relevant query parameters and redirects to `/summary`.
- Tab state uses `?tab=...`; 6A accepts/defaults to `overview` and safely falls back from future
  tab values until 6B ships them.

### Overview

- Keep the header compact with team names, score, match state/result, and a source-status label:
  `Local`, `Synced Primary`, or `Canonical Final`.
- Put date, competition, rule profile/format, primary recorder, and publication details in the
  Overview or a compact details sheet.
- Use explicit result context:
  - Win, Draw, or Loss for completed normal results;
  - AET when extra time decides the result;
  - Pens when a shootout decides the result;
  - Abandoned without assigning Win/Loss.
- Compare tracked and opponent sides in compact Attack, Defense, and Discipline sections.
- Always show key rows such as shots, shots on target, corners, fouls, and cards.
- Hide an optional comparison row only when both sides are zero.
- Show nonzero leaders for goals, assists, shots on target, saves, and defensive actions.
- Preserve tied leaders and hide empty leader categories.
- If projection diagnostics exist, show last coherent match context and diagnostics but suppress
  potentially partial comparison totals, leaders, and finalization controls.

### Navigation and actions

- Cloud Games and Game Info open `/summary?gameId=...` directly.
- Ending a local match keeps the user in Tracker.
- The ended tracker makes `View Summary` the primary action and local `Reopen Match` secondary
  until cloud finalization locks the game.
- Carry a small `from` context for Tracker, Games, Game Info, or Team.
- Use the Soccer dashboard as the safe back-navigation fallback.
- Keep compact source/cloud status visible in the header.
- Full Finalize/Reopen controls appear on Overview only.
- Finalization refreshes the current Summary in place into canonical authority.
- Reopen refreshes in place into non-final primary authority, then offers Resume/Open Tracker when
  the user owns an editable stream.

### Loading and freshness

- Use stable skeleton dimensions so the score/header layout does not jump.
- Errors identify the failed authority source and offer explicit retry.
- Never retain a stale primary after a transition to canonical final.
- Persist cloud authority in the summary URL before a clean final can discard its local binding.
- Keep the last good non-final cloud Overview visible when a background refresh fails; show a
  retryable freshness warning instead of replacing it with a full-page error.
- Refresh non-final cloud summaries:
  - on focus;
  - through manual retry/refresh;
  - every 30 seconds while the page remains active.
- Canonical finals are static except for explicit refresh after Finalize/Reopen or manual retry.
- Do not add realtime subscriptions in SOC-6A.

## 3. Summary Source Model

Introduce one discriminated source result consumed by presentation components:

```ts
type SoccerSummarySource =
  | {
      kind: 'local'
      state: GameState
      recorder: null
      publication: null
      editable: boolean
    }
  | {
      kind: 'cloud_primary'
      state: GameState
      recorder: SoccerRecorderSummary
      publication: null
      editable: false
    }
  | {
      kind: 'canonical'
      state: GameState
      recorder: SoccerRecorderSummary
      publication: SoccerCanonicalPublication
      editable: false
    }
```

Exact naming may follow local conventions, but the source kind, authority, and editing capability
must remain explicit. Components must not infer authority from a mixture of `gameStatus`,
`eventStream`, and route shape.

### Local source

- Require current `state.sport.id === 'soccer'`.
- Reuse the current projected state and inspection without writing or cloning it into parking.
- Keep local completion visibly distinct from canonical finalization.
- Set `editable` only while `state.cloudSync.gameStatus !== 'final'`.
- When a bound local state is cloud-final, load canonical authority through its `gameId`. If that
  canonical load fails, show the fail-closed final error with `editable: false`; never expose
  local event edits or local Reopen.
- Do not expose Finalize until the game is cloud-bound and normal readiness checks pass.

### Cloud source

- Build on the SOC-5 recorder/canonical loaders.
- Read cloud game status before choosing primary versus canonical authority.
- For `final`, require an active canonical publication and successful deterministic rebuild.
- For non-final, resolve `effective_soccer_primary_recorder` through the existing SOC-5C contract
  and load only that effective primary into the main model. A recorder-dialog selection may
  change the effective primary through its authorized RPC, but an arbitrary UI stream pick never
  feeds Overview totals.
- Other-recorder presence remains available through the existing recorder control but never enters
  Overview totals.
- Do not call `openGameSnapshot`, `resumeParkedGame`, or aggregate cloud hydration.

### Diagnostics

- Preserve raw inspection diagnostics and last coherent projected match context.
- Mark the summary unhealthy.
- Suppress team comparison, leaders, and Finalize.
- Keep retry and recorder/recovery paths reachable.
- Never silently use partial projection totals as official-looking output.

## 4. Overview Read Model

Create pure helpers that turn one healthy soccer projection into display-ready values.

### Result

The result helper owns:

- score line;
- tracked result label;
- regulation/extra-time/shootout decision label;
- abandoned and suspended wording;
- shootout score when present.

It must not infer match outcome from `games.home_team_score` when canonical events are available.

### Team comparison

Start with event-derived core rows:

| Section | Rows |
|---|---|
| Attack | Shots, shots on target, corners, offsides, penalty attempts/goals where present |
| Defense | Saves, tackles won, interceptions, clearances, recoveries, blocked shots |
| Discipline | Fouls, yellow cards, red cards, penalties won/conceded, staff cards where present |

Goals remain represented by the primary score rather than duplicated as the first comparison row.
Key rows stay visible at zero. Optional rows use the reviewed both-sides-zero suppression rule.

### Leaders

Leader helpers:

- use tracked match participants only;
- include every tied participant at the maximum nonzero value;
- preserve stable match participant identity;
- format unresolved local participants normally within the game;
- derive assists from primary plus secondary assist totals for the combined leader;
- define defensive leader value from the reviewed core defensive actions rather than a generic
  weighted player score;
- hide categories with no positive value.

SOC-6A leaders are game context only and do not change `SportConfig` or aggregate stat ids.

## 5. UI Structure

Recommended component boundary:

```text
src/pages/SoccerSummary.tsx
src/components/soccer-summary/
  SoccerSummaryHeader.tsx
  SoccerSummaryTabs.tsx
  SoccerOverview.tsx
  SoccerTeamComparison.tsx
  SoccerMatchLeaders.tsx
  SoccerMatchDetails.tsx
src/lib/soccer/
  summary.ts
  summarySource.ts
```

Names may be adjusted to established local conventions. Keep data loading in the page/source
module, pure derivation in `src/lib/soccer`, and rendering in focused components.

### Responsive behavior

- Use the existing narrow soccer workspace width and current shell language.
- Keep score columns stable across long team names.
- Tabs use stable dimensions but only Overview is visible in 6A.
- Team comparison uses aligned tracked/opponent columns without horizontal scrolling.
- Leader rows wrap safely for long participant names and tied leaders.
- Do not add nested cards or a marketing-style header.

## 6. Routing and Integration

### `src/App.tsx`

- Route active soccer `/summary` to `SoccerSummary` in development until SOC-6E removes the final
  production gate.
- Preserve existing basketball `GameSummary`.
- Replace the development-only `SoccerCloudReview` route with a compatibility redirect that keeps
  `gameId`, `tab`, `from`, and team context.

### Tracker

- Add `View Summary` after a match ends.
- Navigate to `/summary?tab=overview&from=tracker`.
- Keep local Reopen available as the secondary command when not cloud-final.
- Do not auto-navigate when `soccer.match_ended` is appended.

### Cloud Games and Game Info

- Soccer final and read-only review actions navigate directly to the summary path.
- Do not hydrate the cloud final into active local state.
- Non-final tracking actions continue using SOC-5 resume/open behavior.
- Read-only non-final actions use direct summary authority.

### Back path

Use a helper rather than scattered string construction. It should:

- serialize `gameId`, `tab`, and a constrained `from` value;
- retain `teamId` when returning to Game Info or Team;
- reject unknown `from` values;
- fall back to `/sport/soccer`.

## 7. Finalization and Reopen

Reuse `SoccerFinalizationPanel` and SOC-5 server contracts.

- Show the full panel only for a healthy Overview source with a cloud game binding.
- A non-final source may expose Finalize through normal readiness checks. A canonical cloud-final
  source may expose only the authorized server Reopen action; it never exposes local Reopen or
  event mutation.
- Continue flushing the matching primary queue before finalization.
- After success, reload cloud authority and require canonical source before rendering the final.
- Do not navigate away or hydrate the final into `GameContext`.
- Reopen updates matching parked bindings through the existing GameContext helper.
- Reload as `cloud_primary` in place.
- Offer Resume/Open Tracker only when the role and owned-stream state permit it.
- A manager viewing another recorder's primary remains read-only after reopen.

## 8. Implementation Sequence

1. Add summary path/query helpers and pure tests.
2. Add the discriminated source loader with local, non-final primary, canonical, invalid-final,
   and diagnostic tests.
3. Add pure Overview result, comparison, and leader helpers with edge-case fixtures.
4. Build the responsive Summary header and Overview components.
5. Wire `/summary`, legacy redirect, Tracker, Cloud Games, and Game Info.
6. Integrate Finalize/Reopen in-place refresh and non-final polling.
7. Extend regression documentation and codebase orientation docs.
8. Run focused tests, full tests, lint, build, and mobile/desktop screenshot checks.

No Supabase migration is expected for SOC-6A. If implementation discovers a missing read contract,
stop and amend the plan rather than widening migration 046 or adding an ad hoc direct-table query.

## 9. Automated Verification

Add focused coverage for:

- summary query parsing and safe back-path fallback;
- local route source with no cloud read;
- bound cloud-final local route resolving canonical authority and remaining read-only;
- direct non-final cloud primary source;
- direct canonical-final source;
- final game without active publication failing closed;
- canonical rebuild/projection diagnostics propagating as unhealthy;
- no cloud summary path activating or replacing a parked game;
- result labels for regulation, extra time, shootout, suspended, and abandoned states;
- key comparison rows staying visible at zero;
- optional both-zero comparison rows hiding;
- tied/nonzero leader selection and empty-category suppression;
- source-status labels and Finalize visibility;
- post-finalize source switching from primary to canonical;
- post-reopen source switching from canonical to non-final primary;
- future/invalid `tab` values safely resolving to Overview during 6A;
- basketball `/summary` routing remaining unchanged.

## 10. Manual Regression

Add an SOC-6A section to `docs/REGRESSION_TESTING.md` covering:

1. End a local-only match, remain in Tracker, and open editable local Summary.
2. Reopen locally and verify Summary returns to non-final match context.
3. Retain a local cloud-final binding and verify `/summary` loads canonical authority without
   local edit/Reopen controls.
4. Open a non-final effective primary as viewer without activating a parked game.
5. Open a cloud final from Games while another basketball or soccer game is active.
6. Verify the active/parked game remains unchanged.
7. Finalize from Overview and observe in-place canonical transition.
8. Reopen from Overview and observe in-place non-final transition.
9. Exercise owner/admin/scorer/viewer visibility and actions.
10. Force a missing/invalid canonical publication and verify fail-closed recovery.
11. Force projection diagnostics and verify totals/leaders/finalization are suppressed.
12. Verify focus/manual/30-second refresh for non-final review.
13. Verify long names, ties, zero totals, abandoned results, extra time, and shootouts on narrow
    mobile and desktop widths.
14. Re-run basketball local and cloud summary entry paths.

## 11. Deferred to Later SOC-6 Slices

- Visible Players, Timeline, Field, and Shootout tabs: SOC-6B.
- Summary event editing and detailed player/role views: SOC-6B.
- Field-map normalization and filters: SOC-6B.
- `soc_*` `SportConfig` migration and canonical aggregate RPCs: SOC-6C.
- Account/season soccer defaults: SOC-6D.
- Production route availability, backend capability gate, and final release matrix: SOC-6E.

## 12. Reviewed Decisions

The SOC-6A Q&A selected the recommended option for all 16 questions:

- direct cloud summary never activates local state;
- query-backed tab state;
- fail-closed missing canonical final;
- diagnostics retain context but suppress partial official totals/actions;
- compact categorized team comparison;
- tied nonzero leaders;
- explicit regulation/extra-time/shootout/abandoned result labels;
- compact global status with Overview-only finalization controls;
- direct Games/Game Info summary entry;
- Summary-primary ended-tracker action;
- deterministic source-aware back navigation;
- compact header with secondary match metadata;
- no visible incomplete tabs in 6A;
- stable skeletons, retries, and authority-specific errors;
- in-place reopen transition;
- focus/manual/30-second non-final refresh without realtime.
