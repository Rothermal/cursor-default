# LCF-2: Unattributed Opponent Free Throws

Status: implemented for review on 2026-10-26. Governing scope:
[live capture follow-up](PLAN_LIVE_CAPTURE_FIELD_TEST_FOLLOWUP.md#lcf-2-unattributed-opponent-free-throws).
No migration, live cloud mutation, legacy conversion or rollout-gate change.

## Implemented Behavior

- General opponent free throws default to Unattributed, including awarded trips
  with no opponent roster. Made adds one point and one FTM/FTA; Miss adds one FTA.
  No participant or individual statistical credit is created.
- Player-detail entry and existing trip shooters preserve explicit named prefill.
  Unavailable named shooters require a new selection, never silent team credit.
  Explicitly changing the next attempt does not rewrite preceding attempts.
- Tracked free throws still require eligible resolved players. Opponent named
  players retain eligibility checks. One-and-one closure, period boundaries,
  technical policy, consumed removed positions, stale awards and Undo remain checked.
- Timeline free-throw edit/add and generic shot editing use the same opponent
  team policy. Team actors survive replay, cloud serialization, canonical parsing,
  summary attribution and season aggregate projection without a player mapping.
- Other sports and unrelated direct field-goal capture retain their policies.

## Observed Automated Evidence

- Full suite: **340 files / 3,517 tests passed**. After correcting a test-only
  TypeScript call signature, focused rerun: **2 files / 27 tests passed**.
- `pnpm build` passes TypeScript and production bundling; Vite reports the existing
  large-chunk advisory. `pnpm lint --ignore-pattern 'qa.local/**'` passes with zero
  errors and the three existing Fast Refresh warnings. `git diff --check` passes.
- New command tests cover standalone makes/misses, zero opponent participants,
  tracked and unrelated direct-shot rejection, awarded completion, wrong-side
  actors, one-and-one, removed-position reload/restore, Undo, historical edit/add,
  stale previews, empty-map serialization, summary attribution and canonical
  aggregate totals with no opponent player rows.
- Actual GameTracker browser wiring, with synthetic local state and auth/cloud
  disabled: **8 view combinations / 11 workflows passed**. Standalone and awarded
  attempts were exercised at 390px and 1280px in Light/Dark; additional workflows
  cover tracked required selection, named-trip continuity plus explicit team
  selection, and multiple open awards. No page errors or horizontal overflow.
  Mobile-dark awarded and desktop-light standalone screenshots were inspected.
- Server source audit: shared event storage accepts actors without a player
  mapping; canonical identity substitution targets only `kind: 'player'`; the
  Basketball score policy totals made-shot values independently of actor kind.
  This is source evidence, not a live Supabase verification.

## Pending Owner Replay

1. Start or resume an event Basketball game with no opponent players. Choose the
   opponent team, Free throw, and record one Made and one Miss as Unattributed.
   Verify +1 score, 1/2 FT, no new lineup row and no opponent individual credit.
2. Award two opponent free throws from a tracked foul. Record both without adding
   a player; verify closure. For one-and-one, a first Miss must end the trip.
3. With a named opponent, start a trip from their detail and verify prefill. Switch
   the next attempt explicitly to Unattributed; earlier named credit must remain.
4. Edit/remove/restore an attempt, park/reload, then sync. Verify checkpoint,
   refreshed cloud review and, after ordinary completion, canonical finalization
   and team/season FT totals. Keep a recovery export if any step fails.
5. Replay on physical mobile and installed PWA. Desktop viewport simulation is not
   physical touch, installed-PWA, access-policy or multi-device signoff.

These checks are pending, not waived or marked passed. No new migration is needed.
The separate scoring report concerns a **second game** whose export is still
pending; the first export's verified 17-17 score does not close that report.
LCF-3 capture-first gestures and focused landscape mode are not part of this PR.
