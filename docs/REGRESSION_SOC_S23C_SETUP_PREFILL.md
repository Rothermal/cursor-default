# Regression - SOC-S23C Player Setup prefill

**Prerequisite:** migration `068_soccer_lineup_status_defaults.sql` is applied
and the S23A/S23B client is deployed.

**Scope:** one-time formation-first Soccer Player Setup prefill. No match,
event, cloud-binding, summary, aggregate, parking, or recovery schema changes.

## 1. Automated coverage

The focused suite covers:

- applicable formation precedence over conflicting standalone starter ids;
- formation roles and complete starter ownership without supplementation;
- unavailable formation assignments causing whole-formation fallback;
- no-formation and mismatched-formation fallback to active starter ids;
- roster-role preservation on standalone fallback;
- unavailable saved-starter diagnostics without participant fabrication;
- valid empty defaults as selected all-Bench drafts;
- immutable draft transforms; and
- the existing one-time saved-participant, recorder-edit, roster-readiness, and
  settings-readiness guards.

Run:

```powershell
pnpm exec vitest run src/lib/soccer/teamLineupPrefill.test.ts src/lib/soccer/formation.test.ts src/lib/soccer/lineupDefaults.test.ts src/lib/soccer/matchReadiness.test.ts
```

## 2. Standalone lineup defaults

1. In Team Manage, clear Formation and save a normal Lineup Defaults starting
   group with exactly one goalkeeper.
2. Give at least two players recognizable roster roles that differ from their
   lineup status.
3. Start a fresh cloud-team Soccer match and continue to Player Setup.

Expected:

- every active roster player remains selected for the match;
- saved starter ids show as Starter and every other active player shows as
  Bench;
- each player keeps the team roster role;
- one informational notice says lineup defaults were applied; and
- kickoff validation remains the authority for starter count, goalkeeper, and
  short-handed confirmation.

## 3. Formation precedence and fallback

1. Save a valid formation whose assigned players differ from Lineup Defaults.
2. Start a fresh matching-size match.
3. Change match size so the formation no longer matches and start another
   fresh setup.

Expected:

- the matching formation owns the whole starter group and assigned broad
  roles; standalone defaults do not fill unassigned slots;
- the mismatched formation produces a visible warning; and
- the second setup falls back to standalone statuses while retaining roster
  roles.

## 4. Stale, inactive, and unavailable settings

1. Save a starter, deactivate that team membership, and start a fresh match.
2. Confirm the unavailable saved starter is reported and no participant is
   fabricated.
3. Simulate an unavailable/corrupt team-settings response, then retry.

Expected:

- only the active roster becomes participant drafts;
- the setup stays editable and shows the unavailable-starter count;
- failed settings leave the safe roster-role/all-Bench state available; and
- a successful retry applies defaults only if the recorder has not edited the
  draft.

## 5. One-time authority

1. Edit any match roster or lineup field before delayed settings complete.
2. Revisit a setup that already persisted participants.
3. Trigger focus/online refreshes after each case.

Expected:

- delayed defaults never overwrite recorder edits;
- persisted participant drafts never re-prefill; and
- reloads or later settings refreshes do not run the transform twice.

## 6. Exit

- Focused tests and the repository gate pass.
- One deployed standalone-default setup preserves status and role correctly.
- One deployed valid formation wins over conflicting standalone defaults.
- One deployed mismatch visibly falls back without fabricating participants.
- Existing kickoff validation still rejects invalid opening lineups.
