# Regression: HKY-5 Cloud Lifecycle

Record for [HKY-5](PLAN_HKY_5_CLOUD_LIFECYCLE.md). Each slice adds its section when it
lands.

## HKY-5A Server registration and Hockey wrappers

Migrations `072_hockey_event_platform_publication_constraint.sql` (stages the publication
sport check `NOT VALID`) and `073_hockey_event_cloud_lifecycle.sql` (validates and swaps
it, then everything else). Not yet applied to the Supabase project; the owner applies both,
in order, before the HKY-5B client ships.

### Local database

All 73 migrations applied in order to a throwaway PostgreSQL 16 database with stubs for
Supabase's `auth` schema (`auth.users`, `auth.uid()` from `request.jwt.claim.sub`) and the
`anon`, `authenticated`, `service_role` and `authenticator` roles. Calls ran under
`SET ROLE authenticated` with the user set per call. This exercises the SQL, grants and
row-level checks, not PostgREST or the deployed project. The harness is in
`/mnt/project-files/hockey/hky5a-sql/`.

**Server and client parity.** Games built with the real Hockey commands (the same ones the
tracker runs) were loaded as cloud events. The server policy's score was compared with the
client's final score (`result.finalScore`, or the score when abandoned):

| Game | Client | Server | Result |
|---|---|---|---|
| Regulation win with saves, misses, blocks, signed adjustments and an undone goal | 3-1 | 3-1 | Pass |
| Youth tie | 1-1 | 1-1 | Pass |
| Scoreless youth tie | 0-0 | 0-0 | Pass |
| Shootout early clinch (2-0 with one opponent attempt left) | 1-0 | 1-0 | Pass |
| Shootout sudden-death win after a complete round | 0-1 | 0-1 | Pass |
| Review probe 1: reasoned end after only the first attempt of a three-round shootout (goals 1-0, no winner) | 0-0 | 0-0 | Pass |
| Review probe 2: reasoned end after the first sudden-death goal, before the answering attempt | 0-0 | 0-0 | Pass |
| Shootout abandoned mid-round | 0-0 | 0-0 | Pass |
| Overtime goal after a tied regulation | 1-2 | 1-2 | Pass |
| Abandoned in the second period | 2-1 | 2-1 | Pass |
| Ended early with a reason | 0-1 | 0-1 | Pass |
| Reopened, adjusted and ended again | 1-1 | 1-1 | Pass |
| Suspended | not ended | refused | Pass |
| Reopened and not ended again | not ended | refused | Pass |
| In progress | not ended | refused | Pass |

**Refused inputs** (each a copy of a valid game with one change):

| Change | Server |
|---|---|
| Shootout `rounds` missing, `2.5`, or shootout rules `null` | "Hockey shootout rules are unavailable for finalization" |
| Two shootout starts; attempts differing by two; attempts without a start | "invalid Hockey shootout data" |
| Attempt outcome `blocked`; shot outcome `scored`; adjustment delta `2` or `"1"`; a goal on the neutral side; shot schema version 2 | "invalid Hockey scoring data" |
| Adjustments taking a score below zero | "Canonical Hockey scores are invalid" |
| End event schema version 2 | "do not end in a final Hockey outcome" |
| A removed tracked goal (valid) | Accepted 0-1 |

**Lifecycle as real roles** (team game, shootout early clinch):

| Step | Result |
|---|---|
| `get_hockey_release_capabilities` as a scorer | `contractVersion` 1, migration 73 |
| Scorer binds with `bind_hockey_event_game_v5`, uploads 15 events (player actors mapped to participants) and confirms the checkpoint | Pass |
| Readiness: viewer and scorer cannot finalize; owner can; primary is the scorer, ended, checkpoint current, no conflicts | Pass |
| Recorder list: owner sees event counts, viewer sees none | Pass |
| Viewer finalize refused; owner finalize without `canonicalSchemaVersion` refused | Pass |
| Owner finalizes: publication 1, game final at 1-0 (shootout goal added) | Pass |
| Scorer event write after final refused | Pass |
| Reopen with a one-letter reason refused; scorer reopen refused; owner reopens: game in progress, scores cleared, publication 1 inactive with its reason | Pass |
| Scorer publication history refused; owner re-finalizes: publication 2, final 1-0 | Pass |
| Audit rows: `hockey_game_finalized` 1, `hockey_game_reopened` 1, `hockey_game_finalized` 2 | Pass |
| Outsider readiness refused; Hockey setup version 2 refused; personal Hockey bind accepted | Pass |
| Baseball through the private binder and readiness: "Sport is not supported by the event platform" | Pass |

The re-created `bind_event_game_v2`, `get_event_finalization_readiness` and
`finalize_event_game` differ from their 069, 057 and 058 sources only by the added Hockey
lines (checked by script and by `migration073.test.ts`).

### Automated

`src/lib/hockey/migration073.test.ts` (8 cases): staged then validated constraint; Hockey
only, no Baseball, Football or aggregate functions; shared functions equal their latest
sources plus the Hockey branch; terminal predicate; score and decided-shootout policy;
wrapper grants and private cores; canonical schema check before finalizing; handshake.

Checks: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings), `pnpm test`
(264 files, 2498 tests) and `pnpm build` pass.

### Pending

- Apply 072 and 073 to the Supabase project (owner).
- Two-device live check after HKY-5B: one recorder, a viewer on a second device, finalize,
  reopen, correct and re-finalize.
