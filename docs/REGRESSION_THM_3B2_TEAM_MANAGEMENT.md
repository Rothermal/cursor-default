# THM-3B2 verification

## Scope

Teams list/manage host, AccessUnavailable, TeamInviteLinksPanel, both team
settings panels, BasketballLegacySeasonImport, SoccerFormationEditor,
SoccerLineupDefaultsEditor, and SoccerRulesOverrideEditor. Existing shared
audit, guardian, merge, confirmation and Basketball rule controls were already
converted. No new palette, migrations, data/permission changes or public selector.

The formation pitch retains fixed field/line colors and assigned/open markers.
The exact literals and occurrence counts are checked before excluding artwork
from the semantic inventory; other raw colors remain rejected. Warning markers
and the player picker use semantic tokens. THM-5 still owns the live pitch audit.

## Evidence

- 203 files / 1,531 tests pass; the appearance guard includes 78 passing tests.
  TypeScript passes after review fixes; the original production build passed; lint has zero errors
  and the same three existing Fast Refresh warnings.
- PR review added disabled fill to both team refresh controls and formation
  Choose/Change, with three targeted guards, and corrected the parent plan status.
  Invite role text intentionally retains full contrast and parenthesized hierarchy.
- Normalized TypeScript AST comparison confirms all nine runtime files differ
  only in JSX className attributes, not handlers, markup or data logic.
- Automated semantic and transition guards cover all nine changed components.
- One-off isolated Edge fixture rendered the actual formation and Soccer rule
  editors. At 390px and 1280px in both themes, the GK picker opened and assigned
  a long-name player, with no page errors or horizontal document overflow.
  Picker screenshot inspected in Dark; field markings remain visible behind
  the overlay. This used synthetic component props, no cloud writes.
- Temporary fixture and screenshots removed after verification.

## Deployed follow-up

Check real Teams list/create/edit, roster modes and identity actions, member
roles, invite links and pending invitations. Review both sports' team defaults,
read-only access, conflicts, copy/import, formation and lineup defaults, sticky
save controls and confirmations in both themes before enabling production Dark.
These account-backed flows and installed-PWA behavior were not exercised here.
SoccerGameSetup inherits the converted rule editor; GameTracker inherits the
converted access panel. Neither parent is claimed complete by this slice.
Season management remains THM-3B3.
