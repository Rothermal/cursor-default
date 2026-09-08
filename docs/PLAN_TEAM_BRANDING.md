# Team branding

Status: high-level product direction approved; detailed slice plans pending.

## 1. Purpose and sequence

Team identity is a presentation layer on top of
[App theming](PLAN_APP_THEMING.md), not another Light/Dark mode. Complete the
THM-1 through THM-6 release first, then team colors, then optional logo uploads.
Each stage gets a focused plan, implementation branch, tests, and PR.

## 2. Approved decisions

- Branding follows the team being viewed, never the signed-in user. One account
  may belong to many teams, across sports, with independent branding.
- Apply branding only to that team's pages and games. Sports, Account, general
  Settings, and multi-team lists remain neutral; list rows may show their own
  team's identity without recoloring the page.
- Accepted owners/admins edit branding; scorers/viewers can see it but cannot
  edit it. Branding grants no additional team or game access.
- Fields are primary color, secondary color, and one optional team logo.
- App-controlled backgrounds, text, focus, and semantic status colors preserve
  readability in Light and Dark. Team colors are identity/accent inputs, not
  unrestricted page palettes.
- Use current branding on historical games as well as new games. Do not add
  historical branding snapshots or modify stored game/event data.
- The tracked team controls approved page accents. Opponent branding is limited
  to its identity area; unlinked opponents retain their name/nickname and neutral
  fallback. Never infer an opponent team link from a matching name.
- Branding is shared across devices. Managers edit online; cached branding is
  available offline and absent cache falls back to standard appearance.
- Logos are optional and fit fully in a stable square preview without stretching
  or forced cropping. Missing logos show team initials.

## 3. Context and authority

Resolve branding by stable team identity already authorized for the destination.
Do not keep one global selected-team theme that can leak across routes. Clear
the outgoing scoped override immediately on navigation; neutral fallback is
preferable to displaying the previous team's colors while the next team loads.
Discard late responses for an earlier team/account context.

Local games without a linked team use standard appearance. Existing team-bound
games may use current authorized branding without modifying their frozen match
setup. Multi-recorder, canonical, and alternate review must derive identity from
the viewed game's team, not whichever local game happens to be active.

Branding fetch failure must never block capture, parking, sync, or finalization.
Keep cached presentation separate from GameState, event payloads, fingerprints,
and dirty-game tracking. Cache entries must be scoped by account and team; clear
them on sign-out and known access revocation. Offline access cannot discover a
server-side revocation until reconnection; define retention in detailed planning.

## 4. Delivery phases

### TBR-1: Team colors

After THM-6, define versioned team-branding metadata, validated color input,
server-enforced owner/admin writes, stale-edit protection, and explicit reset.
Use a separate compact Branding tab in Team Manage to avoid extending scrolling
settings pages. Read-only users see the current identity without save controls.

Define a narrow scoped token map with safe accent/foreground combinations for
both appearance modes. Preserve original chosen colors as identity swatches;
derive or fall back to readable interaction colors where necessary. Identical,
very light, very dark, or competing team colors must remain usable. Team colors
must not replace warning/error meanings or be the only side indicator.

Inventory team pages, linked-game routes, cloud review, and mixed-team lists.
Implement account/team-isolated reads and offline cache with safe fallback.
No logo upload UI is required in this phase.

### TBR-2: Team logos

Add authenticated upload/replace/remove under the same team-management authority.
Plan image validation, bounded size/dimensions, safe formats, stable object keys,
access policy, and cache invalidation before implementation. Do not assume
public image URLs or accept arbitrary remote URLs as the initial upload model.

Replacement must preserve the prior working logo if upload or metadata save
fails. Address abandoned uploads, old-object cleanup, permission changes during
upload, and cross-account cached images. Logo errors fall back to initials
without breaking layout; offline logo caching requires explicit implementation,
not an assumption that the browser HTTP cache will retain it.

## 5. Verification

- Switch rapidly between differently branded teams and neutral pages; include
  late network responses, multiple tabs, sign-out, and account switching.
- Check owner/admin writes and scorer/viewer denial at UI and server boundaries.
- Test Light/Dark with white, black, matching, and low-contrast team colors;
  preserve focus visibility and text contrast, including disabled controls.
- Verify tracked/opponent identity and historical/cloud review independently of
  the active local game. Unlinked/deleted/inaccessible teams fall back safely.
- Test offline cold/warm cache, branding updates on another device, and failed
  requests without changing game fingerprints or interrupting recording.
- Test logo replace/remove/failure, invalid uploads, initials, and narrow/mobile
  layouts without image distortion or layout shifts.

## 6. Questions for detailed plans

These are not yet approved implementation contracts:

- Exact metadata schema, revision/write API, audit scope, and cache lifetime.
- Exact accent-bearing controls and contrast derivation/fallback rules.
- Whether an existing authorized opponent link is available on each game route;
  creating reusable opponent identities remains separate work.
- Logo format/byte/dimension limits, processing strategy, storage authorization,
  replacement cleanup, and bounded offline cache behavior.

Next planning step: refine THM-1's runtime/token/shared-primitive scope. Do not
block that work on logo storage decisions, and do not expand it into branding
persistence. Cross-sport branding does not imply shared sport rules or layouts.
