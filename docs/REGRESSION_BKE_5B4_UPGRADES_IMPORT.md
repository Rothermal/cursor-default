# BKE-5B4 Basketball Upgrades and Legacy Import Regression

Status: implementation complete. No new migration is required; migration 062 remains the installed
Basketball settings contract. Live profile/import checks remain post-merge evidence.

## Scope

- explicit personal/team profile-change review before a draft changes
- effective before/after rule values with profile-change and preserved-override labels
- compatible override reapplication and fail-closed incompatible profile changes
- manager-only legacy `seasons.team_stats_config` review in Basketball Team Manage
- explicit fallback profile selection for modern-only fields; no governing-profile inference
- one reviewed foul window and timeout pool per legacy regulation period
- preservation of legacy bonus, overtime-foul-reset, and total-timeout behavior
- explicit confirmation for legacy defaults and modern-only mapping
- application to the existing unsaved team draft only; no season mutation or automatic cloud save
- pure authority hierarchy for built-in -> personal/team -> match resolution

Legacy timeout totals do not infer full or 30-second timeout inventories. Regulation and overtime
durations, lineup-boundary metadata, and the player foul limit come from the manager-selected
fallback profile. Missing legacy fields use the existing legacy runtime defaults and are listed for
review before the draft can be applied.

## Automated Evidence

Recorded 2026-08-24:

- `pnpm test`: 161 files, 1,083 tests passed after review hardening
- focused import/hierarchy suite: 2 files, 10 tests passed
- `pnpm exec tsc -b --pretty false`: passed
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, duplicated by the separate
  `.worktrees/bke-5-settings-rollout` checkout
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `git diff --check`: passed

Coverage proves four- and eight-period mapping, explicit fallback-profile authority, clone-safe
previews, invalid legacy rejection, personal/team branch isolation, match-last precedence, exact
source metadata, fail-closed active-layer or match corruption, complete rule-diff presentation
across every catalog transition, and visible base-profile movement beneath preserved overrides.

## Live Checks

After deployment:

1. In personal Basketball Rules, choose a different profile. Confirm no draft value changes until
   Apply Profile and that Cancel restores the selected value.
2. Add a player-foul override, choose another compatible profile, and confirm the review marks the
   override preserved and Apply retains it.
3. Open a Basketball team as owner/admin, open Rules Editor, then Import Legacy Season Rules.
   Confirm no fallback profile is preselected.
4. Select a fallback profile and review legacy values, defaulted fields, fallback values, and the
   period-window mapping. Confirm Apply remains disabled until both acknowledgements are checked.
5. Apply the import. Confirm it produces Unsaved changes, does not save automatically, and Discard
   returns to the last shared revision.
6. Apply again and save. Reload Team Manage and confirm the reviewed customized profile returns.
7. Confirm the season's legacy rules are unchanged and a scorer/viewer receives no import control.

## Deferred

- setup consumption, source-revision binding, and match override UI: BKE-5C
- event-model production opt-in and combined live evidence: BKE-5D
- clock, substitutions, lineup intervals, and equal-play enforcement: BKE-6
