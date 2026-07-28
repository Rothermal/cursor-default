# SOC-6E Soccer Release Regression Matrix

Status: automated hardening implemented; development/staging operator evidence pending.

## Purpose

This is the release record for SOC-6E. It consolidates the Soccer checks introduced from SOC-1
through SOC-6D with the release-policy, cloud-capability, multi-sport, PWA, and Basketball
regressions required before Soccer can be enabled in production.

SOC-6E2 tests the unreleased policy. SOC-6E3 repeats the release-sensitive rows after changing the
centralized production flag. Do not treat CI alone as release sign-off.

## Release Invariants

- Soccer is disabled by default.
- An unreleased production build hides Soccer discovery and blocks every new-game entry.
- Release state and the device toggle never hide an existing local or authorized cloud record.
- Development preview uses the normal route tree and respects the same device toggle.
- Cloud capability preflight happens before game replacement or cloud-authority mutation.
- Capability success grants no team role or operational write authority.
- Basketball behavior and multi-game ownership boundaries remain unchanged.
- Migration `049_soccer_release_capabilities.sql` is the migration ceiling for SOC-6E unless a
  separately reviewed release blocker requires otherwise.

## Automated Evidence

Run from the repository root and attach the CI URL or command output to the operator record.

```text
pnpm lint
pnpm test
pnpm build
```

| Contract | Primary coverage |
|---|---|
| Preview, unreleased, released, toggle, and non-Soccer availability | `src/lib/sportAvailability.test.ts` |
| Existing routes and preflight-before-mutation ordering | `src/lib/soccer/releaseEntryGuards.test.ts` |
| Direct development-check allowlist | `src/lib/soccer/releaseEntryGuards.test.ts` |
| Strict capability parsing, failure classification, retry, and account cache isolation | `src/lib/soccer/releaseCapabilities.test.ts` |
| Authenticated read-only migration 049 handshake and 043-048 dependency checks | `src/lib/soccer/migration049.test.ts` |
| Malformed legacy settings keep Soccer disabled | `src/lib/settingsStorage.test.ts` |
| Basketball/Soccer parking, quota, import rollback, recovery, and ownership | `src/lib/gameParking.test.ts` |
| Event validation, projection, correction, cloud transport, recorder isolation, and recovery | `src/lib/gameEvents/`, `src/lib/soccer/` tests |
| Finalization, canonical publication, reopen, summary tabs, aggregates, and settings | SOC-5/SOC-6 tests under `src/lib/soccer/` and `src/hooks/` |
| Basketball setup, counters, shot chart, sync, summaries, and aggregates | Full `pnpm test` suite |

### SOC-6E2 implementation run

| Field | Value |
|---|---|
| Base commit | `5d74d8e` |
| Branch | `feature/soc-6e2-release-hardening` |
| Migration ceiling | `049` |
| Lint | Pass; 0 errors, 3 existing Fast Refresh warnings |
| Tests | Pass; 100 files, 640 tests |
| Production build | Pass; PWA generated with 12 precache entries |
| CI | Pass; PR #250 |

## Operator Record

Complete one record for development preview and one for an unreleased production build. SOC-6E3
adds a released-production and deployed GitHub Pages record.

| Field | Development/staging | Unreleased production | Released production |
|---|---|---|---|
| Date/time | Not run | Not run | SOC-6E3 |
| Commit/deployment | Not run | Not run | SOC-6E3 |
| Supabase project | Not run | Not run | SOC-6E3 |
| Highest migration | Must be `049` | Must be `049` | Must be `049` |
| Browser/version | Not run | Not run | SOC-6E3 |
| Browser or installed PWA | Not run | Not run | SOC-6E3 |
| Viewport/device | Not run | Not run | SOC-6E3 |
| Accounts used | Not run | Not run | SOC-6E3 |
| Team roles used | Not run | Not run | SOC-6E3 |
| Reviewer | Not run | Not run | SOC-6E3 |

Use `Pass`, `Fail`, `Blocked`, or `Not run` in Result. Evidence should identify a screenshot,
screen recording, console excerpt, database query result, or issue link without including access
tokens, invite tokens, email addresses, or event payloads.

## A. Availability And Historical Access

| ID | Build/mode | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-A01 | Development, toggle off | Open Sport Select and direct `/#/sport/soccer` | Select hides Soccer; dashboard keeps history/resume destinations and disables New Game | Not run |
| E2-A02 | Development, toggle on | Enable Soccer and open Select/dashboard | Soccer is discoverable and New Game is available through normal routes | Not run |
| E2-A03 | Development | Disable Soccer with an active and parked Soccer game | Existing games remain visible and resumable; no record is changed | Not run |
| E2-A04 | Unreleased production | Inspect Settings and Sport Select with stored Soccer true and false | Settings says Coming soon with a disabled switch; Select never discovers Soccer | Not run |
| E2-A05 | Unreleased production | Open direct Soccer dashboard | Existing active/parked and historical destinations remain; New Game stays disabled | Not run |
| E2-A06 | Unreleased production | Open existing setup, players, tracker, local summary, Cloud Games, Game Info, and cloud Summary links | Existing records use normal authority/source-health behavior and are not redirected by release state | Not run |
| E2-A07 | Unreleased production | Try dashboard, Team Info, team setup deep link, and direct setup new-game entry | Every new-game path stops before active/parked state mutation | Not run |
| E2-A08 | Any | Sign out, sign in as another account, then return to Settings | Device Soccer toggle persists locally; account data and capability success do not cross accounts | Not run |
| E2-A09 | Development | Set malformed legacy JSON values including `"soccer":"true"` | Soccer remains disabled and the app does not crash | Automated; manual optional |

## B. Capability And Backend Failure States

Use a disposable development/staging project. Do not alter the production migration history to
simulate missing functions.

| ID | Backend state | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-B01 | Through 049 | Start from Soccer Team Info and a `teamId` setup deep link | Capability and team defaults load together; Continue succeeds for an authorized role | Not run |
| E2-B02 | Missing 049/schema cache | Attempt the same cloud start | Backend update guidance appears before parking/replacement; local-only choice is explicit | Not run |
| E2-B03 | 049 with a required 043-048 dependency absent in a disposable project | Call preflight | Server returns the older contract classification without schema object details | Not run |
| E2-B04 | Malformed/older/newer test response | Exercise the parser or controlled test client | Invalid fails closed; older requests backend update; newer requests client update | Automated |
| E2-B05 | Installed stale PWA simulation | Trigger newer-contract guidance, reload, and repeat if needed | Copy directs reload, then close/reopen if the installed shell remains stale | Not run |
| E2-B06 | Offline | Attempt a cloud-team start, retry online, then choose local while offline | Offline is retryable and not called a migration failure; local play does not claim cloud authority | Not run |
| E2-B07 | Signed out/suspended/no app access | Attempt preflight | Authentication/access message is generic; no backend schema details or data are exposed | Not run |
| E2-B08 | Ready capability, unauthorized team operation | Attempt scorer/viewer/removed-member operations | Operational RPC/RLS remains authoritative; handshake success grants nothing | Not run |
| E2-B09 | Capability failure with another active game | Record active and parked ids before and after failure | Active id, parked ids, game state, and dirty state remain unchanged | Not run |

## C. Local, PWA, Parking, And Recovery

| ID | Mode | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-C01 | Supabase unconfigured | Enable preview and complete a local Soccer match | Setup, capture, correction, parking, and local Summary work without cloud claims | Not run |
| E2-C02 | Online browser | Park Basketball, start Soccer, resume Basketball, then reverse | Both records retain sport-specific state and resume the correct workspace | Not run |
| E2-C03 | Installed PWA | Repeat E2-C02, refresh each active game, then close/reopen | Active and parked records survive; no basketball court appears for Soccer or vice versa | Not run |
| E2-C04 | Installed PWA offline | Capture and correct Soccer events, park, open Basketball, and reconnect | Local writes remain coherent; reconnect drains only owned dirty records | Not run |
| E2-C05 | Near 12-game cap | Add both sports through the cap and attempt one more | The cap blocks safely with a useful message; existing records remain intact | Not run |
| E2-C06 | Import/export | Export mixed sports, import into a clean device scope, and inspect counts | Import is parked-only, preserves valid ids, reports skips, and keeps sport state | Not run |
| E2-C07 | Import quota/write failure | Force insufficient storage during a disposable import | Batch rollback leaves the prior manifest and records coherent | Not run |
| E2-C08 | Account switch | Create anonymous/account A/account B records and alternate sessions | Records and dirty sync ownership stay isolated; no foreign cloud binding hydrates | Not run |
| E2-C09 | Recovery conflict | Create a same-recorder divergence, reload, resolve each option | Conflict pauses retry and each resolution resumes from one coherent stream | Not run |
| E2-C10 | Recovery export | Export while Soccer is disabled and while capability preflight fails | Recovery remains available and does not require release/capability success | Not run |

## D. Roles, Recorders, And Finalization

| ID | Role/state | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-D01 | Owner/admin | Start, edit, finalize, select primary, and reopen | Manager actions succeed with required reasons/audit; canonical history is append-only | Not run |
| E2-D02 | Scorer | Start and operate an authorized team recorder | Tracking works; manager-only primary/finalization/settings actions remain unavailable | Not run |
| E2-D03 | Viewer | Open live and final team records | Read-only review works; capture, correction, recorder creation, and writes are absent/denied | Not run |
| E2-D04 | Removed/expired member | Revisit existing URLs | Current membership/RLS decides access; release state does not broaden it | Not run |
| E2-D05 | Two recorders | Record independently and inspect Other recordings | Streams remain isolated; selecting another stream never blends or mutates the primary | Not run |
| E2-D06 | Primary conflict | Produce divergent candidates and prepare manager resolution | Conflict is explicit; no silent merge or canonical publication occurs | Not run |
| E2-D07 | Finalized game | Attempt normal capture and a late non-primary queue drain | Capture is rejected; eligible late upload is audit-only and cannot alter canonical output | Not run |
| E2-D08 | Reopened game | Reopen, edit the primary, and finalize again | Prior publication is invalidated but retained; new publication becomes active | Not run |

## E. Summary, Field, Aggregates, And Settings

| ID | Surface | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-E01 | Non-final Summary | Review Overview, Players, Timeline, Field, and Shootout as applicable | Effective-primary source is labeled; unhealthy sources suppress misleading detail | Not run |
| E2-E02 | Canonical final Summary | Repeat direct links with Soccer disabled | Canonical authority remains reachable and read-only; all totals share one source | Not run |
| E2-E03 | Field/Timeline correction | Edit located and unlocated events from an owned local source | Revision/removal/restore is reflected consistently; remote sources stay read-only | Not run |
| E2-E04 | Aggregates | Open team, season, tournament, player, and career destinations | Only active completed canonical publications contribute; partial quality is explicit | Not run |
| E2-E05 | Aggregate authorization | Compare manager, viewer, and unrelated account | RLS-scoped results and diagnostics match role; no source payload details leak | Not run |
| E2-E06 | Personal settings | Test anonymous, account, offline pending, retry, and conflict choices | Cache scopes stay isolated and explicit resolution is deterministic | Not run |
| E2-E07 | Team settings | Compare owner/admin/scorer/viewer and copy compatible defaults | Managers edit; scorer/viewer inspect; audit failure rolls back the write | Not run |
| E2-E08 | Match inheritance | Change personal/team defaults around a parked match | Existing snapshot stays fixed; new setup resolves built-in -> personal -> team -> match | Not run |

## F. Responsive And Accessibility

| ID | Surface | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-F01 | 320 x 568 mobile | Run setup, roster, tracker modes/sheets, Timeline, Field, Summary, and Settings | Controls remain reachable and readable with no incoherent overlap or clipped actions | Not run |
| E2-F02 | 390 x 844 installed PWA | Repeat the live capture path in portrait | Safe-area/browser chrome does not hide primary controls; sheets scroll internally | Not run |
| E2-F03 | 1280 x 720 desktop | Review tracker, summary, field clusters, and aggregates | Content remains scan-friendly and stable without stretched controls | Not run |
| E2-F04 | Keyboard only | Navigate tabs, dialogs, segmented controls, reset, capture, and correction | Focus is visible, order is logical, dialogs return focus, and no trap occurs | Not run |
| E2-F05 | Screen reader/status | Trigger loading, save, offline, conflict, error, and completion states | Meaningful state changes are announced without duplicate or sensitive detail | Not run |

## G. Basketball And Shared-Shell Regression

| ID | Surface | Procedure | Expected | Result/evidence |
|---|---|---|---|---|
| E2-G01 | Setup/tracker | Complete Basketball setup, substitutions, stat grid, and Undo | Existing behavior and navigation are unchanged | Not run |
| E2-G02 | Court capture | Record make/miss, assist, optional rebound, player switch, and shot review | Prompt settings, links, chart filters, and undo ordering remain correct | Not run |
| E2-G03 | Parking/sync | Park/resume local and cloud-bound Basketball around Soccer | Fingerprint, dirty queue, discard guards, and final sync remain correct | Not run |
| E2-G04 | Final/review | Finalize and review Summary, Team Stats, shot chart, corrections, and cloud history | Existing authority and totals remain unchanged | Not run |
| E2-G05 | Aggregates/settings | Open leaderboard/team/player/career and Basketball settings | Legacy aggregate RPCs remain Basketball-only; sport settings remain separated | Not run |

## H. GitHub Pages And Production PWA

These rows are mandatory for SOC-6E3 final sign-off. They may be rehearsed against an unreleased
deployment during SOC-6E2.

| ID | Procedure | Expected | Result/evidence |
|---|---|---|---|
| E2-H01 | Open the deployed root and direct HashRouter Soccer history links | Base path and routes load without a 404; release policy matches the build | Not run |
| E2-H02 | Complete Google OAuth from a preserved team/game/summary return path | OAuth returns to `/cursor-default/` and restores the safe HashRouter destination | Not run |
| E2-H03 | Install the PWA, deploy a newer build, and exercise refresh/close/reopen | The current shell activates without data loss; repeated stale guidance is actionable | Not run |
| E2-H04 | Go offline after one successful load and open active/parked local games | Cached shell loads and local recovery remains available | Not run |
| E2-H05 | Inspect console/network during capability and access failures | No tokens, schema inventory, event payloads, or cross-account data are exposed | Not run |

## Go/No-Go

SOC-6E2 is complete only when:

- CI is green;
- development/staging is migrated through `049`;
- the development and unreleased-production columns are recorded;
- every failure has an issue link and disposition;
- no correctness, authorization, data-loss, recovery, accessibility, responsive-layout, PWA, or
  Basketball blocker remains.

SOC-6E3 may flip the production release flag only after those conditions are met. Rollback restores
the unreleased SOC-6E2 policy; it does not reverse migration 049 or hide existing Soccer data.

### Sign-off

| Decision | Reviewer | Date | Evidence/notes |
|---|---|---|---|
| SOC-6E2 development/staging | Pending | Pending | Pending |
| SOC-6E2 unreleased production | Pending | Pending | Pending |
| SOC-6E3 released production | Pending | Pending | Pending |
