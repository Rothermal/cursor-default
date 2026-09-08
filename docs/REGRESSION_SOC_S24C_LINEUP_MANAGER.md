# SOC-S24C live lineup manager

The live Field and Lineup tabs now open Manage Lineup. Participant Role actions
focus the same editor's role control. More no longer duplicates these actions.
The manager requires a healthy editable match, a stopped clock or period break,
and accepted tracking access for bound team games.

Both columns remain visible on phones. Row moves and separate role controls
edit an uncommitted target; Bench roles apply only when that player enters.
Opening Lineup and frozen Team Default replace the target and its roles.
Unavailable preset entries remain explicit without inferred replacements.
Reset adopts the current projected lineup. Apply validates the latest state,
rejects stale drafts, and asks separately before playing short-handed.

## Verification

- Preset tests: distinct opening/team defaults, cloning, unavailable/ejected
  and disabled-return vacancies, and old games with no Team Default.
- Existing S24B tests cover transition limits, halftime, intervals, stale
  previews, dependent history, and one-event changes.
- One-off manual verification using Playwright and a temporary isolated
  real-component match fixture (not a committed, runnable suite): 320px, 390px,
  and 1280px widths, no horizontal overflow; short-handed confirmation causes
  no mutation before confirmation; a batch swap records exactly one event.
- Browser screenshot reviewed at 320px; both columns and Apply/Cancel remain
  visible, names truncate, and role controls fit. Modal focus uses the shared
  focus trap, Escape handling, and focus restoration.

## Owner check after deployment

1. Pause a Soccer match and open Manage Lineup from Field and Lineup.
2. Move several players, choose entry roles, and apply once.
3. At halftime, select Opening Lineup; verify the desired starters and roles.
4. In a match with frozen Team Default, compare both presets and Reset.
5. Try a short-handed lineup, cancel the confirmation, then fill the vacancy.
6. Open a Role action and confirm the corresponding role control receives focus.

No new migration. Grouped Timeline presentation/edit integration and the
broader deployed cloud/PWA matrix remain S24D.
