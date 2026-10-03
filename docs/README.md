# Documentation Index

Use current entry points first. A plan in this directory is not necessarily
unfinished implementation; some retain important verification or follow-up work.

## Current references

- [Operations: deployment, cloud configuration and icons](OPERATIONS.md)
- [Automated PR reviews: setup, trust and manual rereviews](AUTOMATED_CODE_REVIEW.md)
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
| Basketball UI | [Workspace modernization](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md) | Initial workspace implementation merged in #418; owner validation pending |
| Basketball attribution and roster | [Team defaults and event capture](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md) | BAR-1 merged; migration 070 applied. BAR-2 dropdowns and quick foul/free throws implemented; review/owner checks pending |
| Clock and live substitutions | [Timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) | Confirmed goals; implementation/schema still proposed |
| Baseball program | [BSB-0 product model](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md), [BSB-1 foundation](PLAN_BSB_1_EVENT_FOUNDATION.md), [BSB-2 roster and setup](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md), [BSB-3 diamond and pitch pad](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md) | BSB-1 engine and BSB-2 roster/defaults/setup merged (migration 071 applied); BSB-3 plan, BSB-3A tracker shell and BSB-3B pitches/in-play/Quick PA merged; BSB-3C between-pitch running and BSB-3D endings, pitching changes, Undo and the opt-in toggle merged; [BSB-4 lineup and corrections plan](PLAN_BSB_4_LINEUP_AND_CORRECTIONS.md) merged; BSB-4A Lineup tab, substitutions and handedness merged; BSB-4B double switch and DH forfeiture merged; BSB-4C Timeline, Remove and Restore merged; BSB-4D Edit any play merged (BSB-4 complete); [BSB-5 Summary plan](PLAN_BSB_5_SUMMARY.md) in review |
| Soccer issues | [Field-test backlog](PLAN_SOC_FIELD_TEST_BACKLOG.md) | Living issue inventory; distinguish implemented from owner-verified |
| Soccer live capture | [S7/S1/S4 plan](PLAN_SOC_S7_S1_S4_LIVE_CAPTURE.md) | Implemented (S7A, S7B, S1, S4); pending deployed verification |
| Shot metadata/direction | [S15/S16 regression](REGRESSION_SOC_S15_S16_SHOT_DETAILS.md) | Implemented; deployed checks remain separately recorded |
| Basketball release evidence | [BKE-6E regression](REGRESSION_BKE_6E_RELEASE.md) | Preserve pending evidence and reported issues; reconcile with owner results before archiving |
| Appearance release | [THM-6 regression](REGRESSION_THM_6_APPEARANCE_RELEASE.md) | Released for owner use; retain pending deployed checks |
| Football program | [FBE-0 product model](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md) with [FBE-1](PLAN_FBE_1_ROSTER_POSITIONS_AND_UNITS.md), [FBE-2](PLAN_FBE_2_PLAY_EVENT_MODEL.md), [FBE-3](PLAN_FBE_3_FIELD_AND_LIVE_CAPTURE.md) | FBE-0 direction approved 2026-09-26; phase Q&A before code; no code yet |
| Hockey | [HKY-0 product model](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md), [HKY-1 plan](PLAN_HKY_1_FOUNDATION_RULES_AND_ROSTER.md), [HKY-2 plan](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md), [HKY-3 plan](PLAN_HKY_3_PENALTIES_STRENGTH_AND_OUTCOMES.md), [HKY-4 plan](PLAN_HKY_4_TIMELINE_AND_CORRECTIONS.md), [HKY-5 plan](PLAN_HKY_5_CLOUD_LIFECYCLE.md) | HKY-1 implemented; HKY-2 implemented: rink, shots, goalies, faceoffs, plays, Undo, and the owner tracker and setup behind a default-off device toggle (HKY-2E); HKY-3A implemented: penalties, the penalty box and derived strength; HKY-3B implemented: goal strength, power plays, plus/minus, timeouts, icing and offside; HKY-3C implemented: 3v3 overtime strength, the shootout and the final result (HKY-3 complete); HKY-4 Timeline and corrections plan approved; HKY-4A implemented: read-only Timeline tab; HKY-4B implemented: edit, remove and restore with a consequence preview; HKY-4C implemented: game order, Change time and recorded-later additions (HKY-4 complete); HKY-5 cloud lifecycle plan approved; HKY-5A implemented: server registration, score policy and Hockey wrappers (migrations 072-073, not yet applied) |
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
