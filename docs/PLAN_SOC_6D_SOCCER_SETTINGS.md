# SOC-6D Soccer Settings and Default Hierarchy

Status: SOC-6D1 and SOC-6D2 implemented. SOC-6D3 and SOC-6D4 remain planned.

## 1. Goal

Add versioned soccer defaults that follow an authenticated user across devices, remain fully
usable for anonymous and offline tracking, and support manager-owned team overrides without
changing existing match snapshots.

SOC-6D establishes one deterministic hierarchy:

```text
built-in app defaults
  -> personal soccer defaults
  -> shared team soccer overrides
  -> per-match overrides
  -> immutable match rules snapshot
```

Later layers win per field. Personal settings are complete across the configurable fields. Team
and match layers are sparse overrides so inherited changes remain visible and reversible.

SOC-6D does not expose Soccer in production, add individual stat/event toggles, rewrite existing
games, add Realtime subscriptions, or perform the broader application reskin. Production
availability remains SOC-6E.

## 2. Existing Architecture

The implementation must evolve these existing boundaries rather than introduce a parallel rules
system:

- `src/lib/soccer/rules.ts` owns `DEFAULT_SOCCER_MATCH_RULES`, validation, normalization, and the
  current layered resolver.
- `SoccerMatchSetup.rulesSnapshot` is the match rule authority after setup.
- `SoccerGameSetup` currently initializes directly from a stored snapshot or built-in defaults
  and edits a complete resolved rule object.
- `SettingsContext` and `settingsStorage.ts` currently store flat device-local app preferences
  under `statkeeper_settings`.
- `firstPeriodAttackingDirection` is match-specific setup data.
- Field flip/orientation is a display preference and is not a match rule.
- Teams have shared owner/admin authority. A season can contain multiple teams, so shared soccer
  defaults must be team-scoped rather than season-scoped.

The current `SoccerRuleLayers.seasonRules` name should become `teamDefaults` or equivalent when the
new hierarchy lands. Temporary compatibility inside the resolver is acceptable during a delivery
slice, but the completed API must not imply that one season silently controls every team in it.

## 3. Product Contract

### 3.1 Supported settings

Personal soccer settings expose every currently implemented pregame rule:

- regulation segment count, labels, and durations;
- extra-time segment count, labels, and durations;
- count-up or countdown clock direction;
- continuous or period-local clock display;
- maximum players on the field;
- return substitutions;
- substitution and substitution-window limits;
- maximum assists per goal;
- yellow-card exit policy;
- red-card replacement policy;
- draw, extra-time, and shootout tie resolution;
- initial shootout kicks per side;
- unused-goalkeeper shootout replacement.

`extraTimeAvailable` and `shootoutAvailable` are legacy compatibility mirrors derived from
`tieResolution`. They are not independent settings, are never shown as separate controls, and are
rejected if present in a stored personal, team, or match-default payload. The resolver derives
both values when it builds the complete `SoccerMatchRules` snapshot.

`regulationSegments` and `extraTimeSegments` each resolve atomically as one array-valued field.
The UI may edit a segment's count, label, or duration, but saving any such change stores the
complete array at that layer. Source labels and reset behavior apply to the whole segment array;
SOC-6D does not introduce element-wise inheritance.

These controls are grouped into Common, Match Format, Discipline, Substitutions, and Advanced
sections. IFAB, U.S. High School, and future profiles are editable starting bundles rather than
locked authorities. Reset restores the inherited values for the selected scope.

Every implemented event family remains available. Individual statistics and event families do not
become settings toggles. Optional modules may add their own toggles only after those modules ship.

### 3.2 Display orientation

The preferred field orientation is a personal recorder display preference:

- it follows the signed-in user and has an anonymous local fallback;
- team defaults cannot enforce it;
- it does not change event coordinates or match rules;
- actual first-period attacking direction remains match-specific and must be confirmed in setup.

### 3.3 Settings surfaces

Personal defaults live at **Settings -> Sports -> Soccer**. The page uses compact grouped sections
and explicit Save and Discard actions with a dirty-state indicator.

Shared defaults live under **Team Manage -> Soccer Defaults**:

- only accepted owners and admins may edit;
- scorers and viewers may inspect effective values;
- personal Soccer settings provide a shortcut to the selected team's editor;
- non-soccer teams cannot store soccer settings.

The UI supports resetting one section or the complete scope. Before save, it previews the
effective result and shows each field's source: built-in, personal, team, or match.

## 4. Resolution and Match Setup

### 4.1 Resolver behavior

The resolver accepts independently validated layers and returns:

- the complete effective `SoccerMatchRules`;
- per-field source metadata;
- diagnostics for any rejected stored layer.

Resolution is deterministic and field-based. Invalid or unsupported stored objects are rejected as
a whole and replaced by the next valid inherited result. The UI shows a warning and enough
diagnostic context to repair or reset the affected scope; it never silently applies a partially
trusted object.

Personal settings are complete and valid across the configurable fields. Team and match settings
store only fields that differ from their inherited values. Clearing an override resumes
inheritance.

### 4.2 Setup behavior

Match Setup begins with the current resolved built-in, personal, and selected-team defaults. It
shows a compact source summary and per-field source labels.

- A setup edit becomes a sparse match override.
- Reset restores the currently inherited result.
- Changing the selected cloud team re-resolves inherited values while preserving explicit match
  overrides.
- Existing setup drafts with a `rulesSnapshot` retain that snapshot unless the user deliberately
  opens setup and resets or edits it.
- Continuing from Match Setup fixes the complete resolved `rulesSnapshot`.
- Player selection and kickoff retain that fixed snapshot.
- Reopening setup permits deliberate edits or reset and produces the next explicit snapshot.

Settings changes after setup never update an in-progress, ended, parked, cloud-bound, or finalized
game. Existing games and pre-SOC-6D snapshots require no data rewrite.

## 5. Local and Account Settings

### 5.1 Anonymous and authenticated scopes

Anonymous local settings and account settings are separate scopes.

- Signing out returns immediately to anonymous defaults.
- Account caches are keyed by user id and remain inactive for other users.
- Pending account edits remain in that account-keyed cache after sign-out. They are not applied to
  the anonymous scope and resume reconciliation only when the same account signs in again.
- On first sign-in, existing cloud defaults win.
- Anonymous defaults may initialize a cloud profile only when that user has no cloud settings
  record.
- Signing into an account never silently overwrites established cloud defaults with device state.

The app loads the user's cached settings immediately and reconciles with Supabase in the
background. This does not block the app shell or local gameplay. Sync state and errors appear on
the settings surface.

### 5.2 Offline edits

Personal defaults remain editable offline:

- save locally with a pending-sync marker;
- retry on reconnect, focus, or explicit refresh;
- compare the expected cloud revision before upload;
- do not discard either side when the revision changed remotely;
- offer **Use Cloud** or **Keep This Device** to resolve the conflict.

Shared team-default editing is unavailable offline because it changes a shared authority. Cached
team defaults may remain visible and can continue to seed local match setup, clearly labeled with
their last sync state.

If the SOC-6D backend migration is unavailable, personal settings continue locally with a
backend-update warning. Shared defaults are unavailable/read-only. Local and existing game
workflows remain usable.

No Realtime subscription is required. Refresh on settings entry, window focus, reconnect, and
explicit Refresh. Compare-and-swap saves provide the concurrency boundary.

## 6. Cloud Data Contract

Use generic sport-settings tables so later sports can reuse the storage and conflict model without
sharing sport-specific schemas.

### 6.1 Personal settings

```text
user_sport_settings
  user_id uuid
  sport_id text
  schema_version integer
  revision integer
  settings jsonb
  updated_at timestamptz
```

The primary key is `(user_id, sport_id)`. RLS permits an active user to read only their own row.
Direct writes are denied; a narrow revision-aware RPC creates or updates the row.

### 6.2 Team settings

```text
team_sport_settings
  team_id uuid
  sport_id text
  schema_version integer
  revision integer
  settings jsonb
  updated_at timestamptz
  updated_by uuid
```

The primary key is `(team_id, sport_id)`. Read access follows accepted team membership. Writes
require accepted owner/admin authority and a soccer team for `sport_id = 'soccer'`. The backend
derives sport compatibility from the team's season/sport relationship and does not trust a client
claim.

Team saves record `updated_at` and `updated_by` and append an immutable access-audit event
containing the settings scope and changed field names. Audit payloads do not copy full before/after
configuration objects. Migration 040 already accepts regex-valid text event types and exposes the
fixed-`search_path` `record_access_audit_event` helper for internal use, so
`soccer_settings_changed` requires no audit-table or event-type schema change; the team-settings
write RPC calls the existing helper.

### 6.3 RPC behavior

Personal and team writes use narrow compare-and-swap RPCs:

- callers provide the expected revision;
- create requires that no row exists;
- update requires an exact current revision;
- success increments revision and returns the saved row;
- stale revisions return a stable conflict code and current revision;
- a concurrent-create uniqueness collision is translated into that same stable conflict response
  with the winning row and revision, rather than leaking a primary-key error;
- payloads are validated for sport id, schema version, known keys, value ranges, and complete
  personal versus sparse team shape;
- the persisted configurable schema rejects the derived legacy keys `extraTimeAvailable` and
  `shootoutAvailable`;
- security-definer functions set a fixed `search_path` and re-check active app access.

The exact migration number is selected from the merged baseline when SOC-6D1 starts. The operator
applies migrations manually, and each affected PR calls that out.

### 6.4 Schema versions

Sport-settings schema versions are independent from game event and match snapshot versions.
Unknown versions fail closed to inherited settings with a repair/reset warning. Upgrading stored
defaults never rewrites `SoccerMatchSetup.rulesSnapshot` in existing games.

New teams begin without a team override and therefore inherit the recorder's personal profile.
Owners/admins may explicitly copy defaults from another accessible soccer team. There is no
automatic season transition or cross-team copy.

Migration 018 makes `teams.season_id` non-null in the supported schema. The settings RPC resolves
the team's sport through that required season and fails closed if the relationship is missing,
inaccessible, or malformed; it never treats an unresolved team as soccer-compatible.

## 7. Permissions Matrix

| Capability | Anonymous | Account user | Team scorer | Team viewer | Team owner/admin |
|---|---:|---:|---:|---:|---:|
| Edit local personal defaults | Yes | Yes | Yes | Yes | Yes |
| Sync personal defaults | No | Yes | Yes | Yes | Yes |
| View effective team defaults | Local cache only | With access | Yes | Yes | Yes |
| Edit shared team defaults | No | No | No | No | Yes |
| Copy another team's defaults | No | No | No | No | Yes |
| Apply match overrides during setup | Yes | Yes | Yes | No | Yes |

Existing team/game authorization remains authoritative. SOC-6D settings do not grant game,
roster, player, or finalization access.

## 8. Delivery Slices

### SOC-6D1: Schema, resolver, and local model (implemented)

- Add versioned personal, team, display-preference, source-metadata, and conflict types.
- Refactor the soccer rule resolver to built-in -> personal -> team -> match.
- Add strict parsing and validation for complete and sparse settings objects.
- Preserve legacy match snapshots and current setup behavior behind compatibility tests.
- Add the generic Supabase tables, read policies, narrow write RPCs, and indexes.
- Add local user-keyed caches, anonymous scope, pending metadata, and migration-unavailable
  detection.

Exit condition: pure tests prove hierarchy, source attribution, validation, snapshot compatibility,
and revision conflicts; the migration can be applied without changing existing games.

Implemented foundation:

- `src/lib/soccer/settings.ts` owns soccer settings schema version 1, strict configurable-layer
  parsing, source attribution, whole-layer fallback diagnostics, and personal/team/display types.
- `src/lib/soccer/rules.ts` now resolves built-in -> personal -> team -> match configurable fields
  while legacy match-snapshot normalization still accepts the derived availability mirrors.
- `src/lib/sportSettingsStorage.ts` owns anonymous and user-keyed versioned local cache records,
  pending-write metadata, and account isolation.
- `src/lib/sportSettingsCloud.ts` owns cloud record/result parsing and backend-update
  classification for later sync surfaces.
- Migration `048_soccer_settings_foundation.sql` adds generic personal/team sport-settings tables,
  read-only RLS, strict soccer schema validation, revision-aware write RPCs, manager-only shared
  writes, concurrent-create conflict normalization, and `soccer_settings_changed` audit events.

SOC-6D1 does not mount the settings cache in `SettingsContext`, synchronize it automatically, or
change Match Setup. Those integrations belong to SOC-6D2 and SOC-6D3.

### SOC-6D2: Personal settings and reconciliation (implemented)

- Build Settings -> Sports -> Soccer with grouped compact controls.
- Add editable preset bundles, section/all reset, effective preview, Save/Discard, and dirty state.
- Sync authenticated defaults across devices through the revision-aware RPC.
- Implement anonymous bootstrap, account cache isolation, sign-out restoration, offline pending
  edits, reconnect, and explicit conflict resolution.
- Persist personal field orientation separately from match rules.

Exit condition: anonymous, authenticated, offline, reconnect, sign-out, and two-device conflict
paths retain a deterministic setting value without blocking gameplay.

Implemented personal settings:

- `SettingsContext` mounts `useSoccerPersonalSettings` alongside the existing flat application
  preferences without changing their storage contract.
- `Settings -> Sports -> Soccer` exposes Common, Match Format, Discipline, Substitutions, and
  Advanced sections with editable competition/format presets, section/all reset, effective
  preview, dirty state, and explicit Save/Discard.
- Personal field orientation remains in the display portion of the personal payload and does not
  enter match rules or event coordinates.
- `sportSettingsCloud.ts` reads the RLS-scoped user record and writes through
  `save_user_sport_settings_revisioned`; malformed responses and missing migration capability are
  fail-closed.
- The controller loads anonymous or user-keyed cache state first, reconciles in the background,
  bootstraps an absent cloud row from anonymous defaults only when appropriate, retains offline
  writes as pending, and retries on focus, reconnect, or Refresh.
- Cloud reconciliation is active only while Soccer is enabled or the personal Soccer settings
  route is open. Untouched built-in defaults do not create a cloud row, and refreshes are
  single-flight so focus/reconnect events cannot race the same pending write.
- Revision conflicts preserve both settings objects and require **Use Cloud** or
  **Keep This Device**. Account caches remain isolated and inactive after sign-out.

SOC-6D2 does not read or write team settings and does not change Soccer Match Setup inheritance.
Those integrations remain SOC-6D3.

### SOC-6D3: Shared team defaults and setup inheritance

- Add the Team Manage soccer-default editor and personal-settings shortcut.
- Enforce owner/admin writes and scorer/viewer read-only presentation in both UI and backend.
- Add explicit copy-from-team with sport/access validation.
- Emit narrow audit events for shared-setting changes.
- Integrate resolved values and per-field source labels into Soccer Match Setup.
- Preserve match overrides across team changes and snapshot rules when setup is continued.

Exit condition: team settings are shared safely, match setup resolves all four layers, and changing
settings cannot mutate an existing game's snapshot.

### SOC-6D4: Hardening and documentation

- Handle unavailable migrations, stale caches, invalid schemas, corrupt local data, and failed
  audit writes without weakening authorization.
- Complete responsive and accessibility review for settings and setup.
- Add the SOC-6D automated/manual regression matrix.
- Update README, agent documentation, migration instructions, and SOC-6 status.
- Confirm production Soccer remains gated until SOC-6E.

Exit condition: all automated tests and the SOC-6D manual matrix pass, cross-device sync is
predictable, and existing soccer and basketball workflows retain their previous behavior.

## 9. Test Matrix

Automated coverage must include:

- every resolver layer alone and in combination;
- per-field source attribution and clearing sparse overrides;
- complete configurable personal versus sparse team/match schema validation;
- unknown versions, unknown keys, corrupt JSON, and invalid nested segments;
- rejection of stored layers containing derived legacy availability keys;
- atomic segment-array override, source attribution, and reset behavior;
- personal and team RPC authorization plus stale-revision conflicts;
- concurrent-create collision mapped to the normal settings conflict response;
- sport mismatch and inaccessible-team rejection;
- anonymous-to-account first initialization and existing-cloud precedence;
- user-keyed cache isolation and sign-out restoration;
- offline pending writes, reconnect, Use Cloud, and Keep This Device;
- setup team switching with explicit match overrides;
- snapshot fixation on Continue and compatibility with existing snapshots;
- team copy and audit metadata;
- migration-unavailable local fallback;
- Soccer remaining unavailable in production discovery.

Manual coverage must include narrow mobile layouts, keyboard/focus behavior, long segment labels,
Save/Discard and reset confirmation, owner/admin versus scorer/viewer views, two browser sessions
editing the same scope, multiple accounts on one device, and a soccer game parked before settings
change and resumed afterward.

Re-run basketball app settings, basketball sport settings, setup, active/parked game restoration,
and account sign-out regression paths because SOC-6D changes shared settings infrastructure.

## 10. Deferred

- Production Soccer discovery and enable/disable enforcement (SOC-6E).
- Realtime settings subscriptions.
- Organization-wide or season-wide inherited defaults.
- Locked presets or manager-enforced recorder display orientation.
- Individual event/stat-family toggles.
- Automatic copying between teams or seasons.
- Full before/after settings payloads in the access audit.
- A broad settings/application visual reskin.
- Migrating basketball settings into the generic account-backed sport-settings tables. Basketball
  currently stores shared team-stat rules at season scope, so moving them to team scope is a
  product and inheritance change requiring its own Q&A and migration plan, not a lift-and-shift.

## 11. Approved Decisions

The focused Q&A approved the recommended option for all 36 decisions:

- team-scoped shared defaults;
- built-in -> personal -> team -> match precedence;
- generic versioned cloud storage;
- complete configurable personal and sparse shared/match settings;
- separate anonymous and account scopes;
- revision-aware cross-device conflicts;
- anonymous restoration on sign-out;
- offline personal editing with shared editing disabled;
- all implemented pregame rules exposed;
- editable preset bundles;
- personal display orientation and match-specific attacking direction;
- continued development-only availability;
- setup source labels and reset-to-inherited behavior;
- team changes preserving explicit match overrides;
- snapshot fixation when leaving Match Setup;
- team rules separated from personal display preferences;
- compact grouped settings;
- team-management shared editor;
- explicit Save/Discard;
- section and full reset with effective preview;
- owner/admin shared writes and scorer/viewer read access;
- narrow audit metadata;
- explicit compatible-team copy;
- backend sport validation;
- future-ready sport settings tables;
- narrow compare-and-swap RPCs;
- strict whole-object validation and inherited fallback;
- settings versions independent from match snapshots;
- cache-first background reconciliation;
- migration-unavailable local fallback;
- no initial Realtime dependency;
- preserved settings while Soccer is disabled;
- four reviewable implementation slices;
- manual migration operation;
- unchanged existing game snapshots;
- complete automated and manual regression coverage.
