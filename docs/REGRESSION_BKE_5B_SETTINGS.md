# BKE-5B Basketball Settings Exit Regression

Status: BKE-5B1 through BKE-5B4 are implementation-complete through migration 062. The settings
foundation, personal lifecycle, team lifecycle, profile review, and legacy import remain behind the
internal Basketball event-creation gate. Live checks remain release evidence for BKE-5D.

## Delivered Contract

- strict schema-version-1 personal and team payloads over fixed Basketball CAS RPCs
- account-isolated personal cache, device fallback, legacy rebound bootstrap, pending writes, and
  explicit cloud/device conflict recovery
- account/team-isolated online team settings with owner/admin writes and scorer/viewer review
- compact personal Rules/Capture/Display tabs and Team Manage shared rules
- immutable source-linked profile references with sparse validated overrides
- explicit profile-change diff/apply preserving compatible overrides
- reviewed legacy-season import into an unsaved team draft without season mutation or profile
  inference
- deterministic authority branches:

```text
Personal/local event game: built-in -> personal -> match
Cloud team event game:     built-in -> team -> match
```

Display/capture preferences remain personal and non-authoritative. Cloud team rules never inherit
the recorder's personal defaults. Existing legacy games and `seasons.team_stats_config` retain
their original authority.

## Evidence

- BKE-5B1: [`REGRESSION_BKE_5B1_SETTINGS_FOUNDATION.md`](REGRESSION_BKE_5B1_SETTINGS_FOUNDATION.md)
- BKE-5B2: [`REGRESSION_BKE_5B2_PERSONAL_SETTINGS.md`](REGRESSION_BKE_5B2_PERSONAL_SETTINGS.md)
- BKE-5B3: [`REGRESSION_BKE_5B3_TEAM_SETTINGS.md`](REGRESSION_BKE_5B3_TEAM_SETTINGS.md)
- BKE-5B4: [`REGRESSION_BKE_5B4_UPGRADES_IMPORT.md`](REGRESSION_BKE_5B4_UPGRADES_IMPORT.md)

The BKE-5B4 full suite passed 161 files and 1,083 tests on 2026-08-24. Migration 062 had already
been applied and its contract tests remain green. No BKE-5B4 migration is required.

## Exit and Next Boundary

BKE-5B's deterministic persistence/settings exit is satisfied in code and automated coverage.
BKE-5C must consume the hierarchy contract in a mutation-free setup draft, bind the reviewed source
revision, freeze the complete rules snapshot at game start, and keep Event/Legacy authority plus
local-only cloud intent explicit. BKE-5D owns production opt-in and accepted live evidence.
