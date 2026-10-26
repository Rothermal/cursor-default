# Documentation Index

Use current entry points first. A plan in this directory is not necessarily
unfinished implementation; some retain important verification or follow-up work.

## Current references

- [Operations: deployment, cloud configuration and icons](OPERATIONS.md)
- [Automated PR reviews: setup, trust and manual rereviews](AUTOMATED_CODE_REVIEW.md)
- [Disabled multi-agent workflow: retained usage and role briefs](CODEX_ORCHESTRATION.md), [status and historical scope](PLAN_CODEX_ORCHESTRATION.md). Single-agent work is the default; re-enablement requires a new explicit user request
- [App overview and local development](../README.md)
- [Codebase architecture](AGENT_CODEBASE_OVERVIEW.md)
- [Shared product and interaction decisions](PRODUCT_AND_INTERACTION_DECISIONS.md)
- [Access matrix](ACCESS_MATRIX.md)
- [Documentation archive audit](DOCUMENTATION_ARCHIVE_AUDIT.md)

Operations links to the existing [Pages deployment guide](../GITHUB_PAGES_DEPLOY.md)
and labels the [original integration plan](INTEGRATION_PLAN.md) as historical
architecture, not current schema or deployment instructions.

## Active work and open follow-ups

| Topic | Owner document | Status |
| --- | --- | --- |
| Shared tracker UI and legacy retirement | [Four-sport plan](PLAN_TRACKER_UI_UNIFICATION.md), [Basketball layout record](REGRESSION_TUI_1_BASKETBALL_LAYOUT.md), [Basketball cutover record](REGRESSION_TUI_1_BASKETBALL_CUTOVER.md), [Soccer/Hockey alignment](REGRESSION_TUI_2_SOCCER_HOCKEY_LAYOUT.md), [Hockey cutover](REGRESSION_TUI_2_HOCKEY_CUTOVER.md) | Basketball layout/cutover merged #491/#506; Soccer/Hockey layout merged #507. Hockey legacy retirement is implemented for review, completing TUI-2 implementation. Stats, exports and authorized old-data sync remain; no conversion or automatic finalization. Football awaits its event foundations. Deployed checks remain pending; broader rollout stays gated |
| Basketball UI | [Workspace modernization](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md) | Initial workspace implementation merged in #418; owner validation pending |
| Basketball attribution and roster | [Team defaults and event capture](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md) | BAR-1 merged; migration 070 applied. BAR-2 dropdowns and quick foul/free throws implemented; review/owner checks pending |
| Clock and live substitutions | [Timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) | Confirmed goals; implementation/schema still proposed |
| Baseball program | [BSB-0 product model](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md), [BSB-1 foundation](PLAN_BSB_1_EVENT_FOUNDATION.md), [BSB-2 roster and setup](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md), [BSB-3 diamond and pitch pad](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md), [BSB-4 corrections](PLAN_BSB_4_LINEUP_AND_CORRECTIONS.md), [BSB-5 Summary](PLAN_BSB_5_SUMMARY.md), [BSB-6 cloud lifecycle](PLAN_BSB_6_CLOUD_LIFECYCLE.md), [BSB-7 execution plan](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md), [7A server evidence](REGRESSION_BSB_7A_SERVER.md), [7A client evidence](REGRESSION_BSB_7A_CLIENT.md), [7B destination evidence](REGRESSION_BSB_7B_DESTINATIONS.md), [7C personal-settings evidence](REGRESSION_BSB_7C_PERSONAL_SETTINGS.md), [7D cutover evidence](REGRESSION_BSB_7D_EVENT_ONLY_RELEASE.md) | BSB-1 through BSB-7C merged, including #504's offline defaults fix. Owner reports 076-080 applied (080 on 2026-10-23). BSB-7D event-only creation, read-only legacy retirement and creation-only rollback are implemented for review. Old stats, exports, dirty bindings and authorized transport remain; unfinished legacy games are excluded from totals, never auto-finalized or converted. Actual Supabase/RLS, two-device, physical-mobile and installed-PWA checks remain pending under approved owner-only post-deployment validation; broader rollout is not signed off. See per-slice records for historical and current observed evidence |
| Soccer issues | [Field-test backlog](PLAN_SOC_FIELD_TEST_BACKLOG.md) | Living issue inventory; distinguish implemented from owner-verified |
| Soccer live capture | [S7/S1/S4 plan](PLAN_SOC_S7_S1_S4_LIVE_CAPTURE.md) | Implemented (S7A, S7B, S1, S4); pending deployed verification |
| Shot metadata/direction | [S15/S16 regression](REGRESSION_SOC_S15_S16_SHOT_DETAILS.md) | Implemented; deployed checks remain separately recorded |
| Basketball full court | [BKE-7 plan](PLAN_BKE_7_FULL_COURT.md), [BKE-7 regression](REGRESSION_BKE_7_FULL_COURT.md) | BKE-7A through 7D merged; owner game checks remain post-deployment validation. Next layout work is in the shared tracker plan |
| Basketball release evidence | [BKE-6E regression](REGRESSION_BKE_6E_RELEASE.md) | Preserve pending evidence and reported issues; reconcile with owner results before archiving |
| Appearance release | [THM-6 regression](REGRESSION_THM_6_APPEARANCE_RELEASE.md) | Released for owner use; retain pending deployed checks |
| Football program | [FBE-0 product model](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md) with [FBE-1](PLAN_FBE_1_ROSTER_POSITIONS_AND_UNITS.md), [FBE-2](PLAN_FBE_2_PLAY_EVENT_MODEL.md), [FBE-3](PLAN_FBE_3_FIELD_AND_LIVE_CAPTURE.md) | FBE-0 direction approved 2026-09-26; FBE-1 roster/defaults Q&A complete and execution plan approved 2026-10-26; no runtime code yet. FBE-2/FBE-3 still need their own Q&A; existing Football tracking is unchanged |
| Hockey | [HKY-0 product model](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md), [HKY-1 plan](PLAN_HKY_1_FOUNDATION_RULES_AND_ROSTER.md), [HKY-2 plan](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md), [HKY-3 plan](PLAN_HKY_3_PENALTIES_STRENGTH_AND_OUTCOMES.md), [HKY-4 plan](PLAN_HKY_4_TIMELINE_AND_CORRECTIONS.md), [HKY-5 plan](PLAN_HKY_5_CLOUD_LIFECYCLE.md), [HKY-6 plan](PLAN_HKY_6_SUMMARY_AGGREGATES_AND_RELEASE.md) | HKY-1 implemented; HKY-2 implemented: rink, shots, goalies, faceoffs, plays, Undo, and the owner tracker and setup behind a default-off device toggle (HKY-2E); HKY-3A implemented: penalties, the penalty box and derived strength; HKY-3B implemented: goal strength, power plays, plus/minus, timeouts, icing and offside; HKY-3C implemented: 3v3 overtime strength, the shootout and the final result (HKY-3 complete); HKY-4 Timeline and corrections plan approved; HKY-4A implemented: read-only Timeline tab; HKY-4B implemented: edit, remove and restore with a consequence preview; HKY-4C implemented: game order, Change time and recorded-later additions (HKY-4 complete); HKY-5 cloud lifecycle plan approved; HKY-5A implemented: server registration, score policy and Hockey wrappers (migrations 072-073, not yet applied); HKY-5B1 implemented: cloud sync, Cloud or This device at setup, Enable cloud sync and Cloud Games open; HKY-5B2 implemented: Game Info recorders, primary selection, finalize with the server's score, reopen with a reason and a read-only finalized tracker; HKY-5C implemented: personal and team settings, the Team Manage Hockey panel and setup prefill (migration 074, applied); HKY-6 Summary, aggregates and release plan approved; HKY-6A1 implemented: Hockey Summary with Overview, Skaters and Goalies for local and cloud games; HKY-6A2 implemented: Summary Timeline, shot map, faceoff map and Shootout tab; HKY-6B1 implemented: Hockey season-stat sources and aggregate handshake (migration 075, not yet applied); HKY-6B2 implemented: Hockey season stats in Leaderboard, Team Stats, Tournament Stats, Player Profile and Career (needs 075); HKY-6C implemented: Hockey released, every new Hockey game is an event game (owner checklist pending) |
| Team branding | [Branding plan](PLAN_TEAM_BRANDING.md) | Approved high-level direction; detailed implementation pending |
| Local game parking | [Parking plan](PLAN_MULTI_GAME_PARKING.md) | Shipped core; historical cleanup/storage follow-ups remain |
| Delete local copy | [Local deletion checks](REGRESSION_LOCAL_GAME_DELETE.md) | Explicit unsynced deletion implemented for parked games; owner smoke pending |
| Access/security expansion | [Security roadmap](PLAN_ADMIN_SECURITY_ROADMAP.md) | Implemented phases plus deferred scope; retain access matrix |
| Older generic backlog | [Pre-reset README](archived/README_PRE_RESET.md) | Historical candidates, not verified current defects; see audit triage |

## Implementation history and evidence

- [Completed plans](completed/): historical implementation decisions, not new tasks.
- [Archived/superseded documents](archived/): retain rationale; do not implement old
  proposals over current contracts.
- [Regression entry point](REGRESSION_TESTING.md): historical and manual coverage;
  use the feature-specific matrix as well.
- [Basketball event roadmap](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md) and
  [Soccer product model](PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md): retained architecture
  history with references to implementation slices.

When archiving, preserve outstanding items here or in a linked active backlog,
retain evidence without upgrading its status, and repair links or leave redirects.
