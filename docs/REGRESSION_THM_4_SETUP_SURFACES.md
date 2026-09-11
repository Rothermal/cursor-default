# THM-4 Setup Verification

## Scope

GameSetup, PlayerSetup, GameCheckout, BasketballSetupRulesReview, and
BasketballOpeningLineupSetup now use semantic surface, text, border, status,
selection, and disabled colors. Sport names/icons remain in the neutral headers.
Long roster names wrap beside fixed jersey markers and controls. Shared setup
routes carry these presentation changes to other sports as well.

No handlers, setup authority, rules, roster mutations, cloud contracts, or
navigation changed. No migration. Production Dark remains gated. The remaining
Basketball tracker, court/correction, and Summary work is not complete.

## Evidence

- 203 test files / 1,580 tests pass, including 127 appearance surface tests.
  Inventory guards cover all five files; targeted checks protect header sizing,
  roster bounds, and opening-lineup disabled fill/text.
- Actual-component Edge fixtures ran at 390px and 1280px in Light and Dark:
  local Classic Game Setup, populated Player Setup, populated Checkout with a
  selected player, Rules Review with match overrides, opening lineup entry,
  short-handed review, and busy status controls. All 24 cases had no page errors
  or document overflow. Long player/team names were included.
- Lineup interaction checks selected a fifth starter and rejected a sixth with
  the existing inline error. Busy starter controls were disabled. Mobile Light
  setup and Dark roster, checkout, and lineup screenshots were inspected.
- Auth, GameContext, SettingsContext, team settings, and checkout data were
  mocked. Real UI components and lineup transition helpers were used; no real
  cloud writes or saved games were involved. Temporary fixtures were removed.

## Release Follow-up

Validate real team/season/tournament selection, capability failure/retry,
changed-default review, event setup through start, cloud roster loading/errors,
checkout write/busy/error states, keyboard navigation, and PWA behavior. The
shared non-Basketball routes also need deployed regression; the isolated
browser fixtures above used Basketball, not a complete multi-sport flow.

Build/lint results are recorded in the PR. These checks are setup-surface
evidence, not a complete THM-4 or production Dark release signoff.
