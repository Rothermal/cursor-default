# Documentation Index

Use current entry points first. A plan in this directory is not necessarily
unfinished implementation; some retain important verification or follow-up work.

## Current references

- [Operations: deployment, cloud configuration and icons](OPERATIONS.md)
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
| Basketball UI | [Workspace modernization](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md) | Next proposed implementation; interaction direction approved |
| Basketball attribution and roster | [Team defaults and event capture](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md) | Q&A complete; BAR-1 roster/setup, then BAR-2 event selection and quick foul/free throws |
| Clock and live substitutions | [Timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) | Confirmed goals; implementation/schema still proposed |
| Soccer issues | [Field-test backlog](PLAN_SOC_FIELD_TEST_BACKLOG.md) | Living issue inventory; distinguish implemented from owner-verified |
| Shot metadata/direction | [S15/S16 regression](REGRESSION_SOC_S15_S16_SHOT_DETAILS.md) | Implemented; deployed checks remain separately recorded |
| Basketball release evidence | [BKE-6E regression](REGRESSION_BKE_6E_RELEASE.md) | Preserve pending evidence and reported issues; reconcile with owner results before archiving |
| Appearance release | [THM-6 regression](REGRESSION_THM_6_APPEARANCE_RELEASE.md) | Released for owner use; retain pending deployed checks |
| Team branding | [Branding plan](PLAN_TEAM_BRANDING.md) | Approved high-level direction; detailed implementation pending |
| Local game parking | [Parking plan](PLAN_MULTI_GAME_PARKING.md) | Shipped core; historical cleanup/storage follow-ups remain |
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
