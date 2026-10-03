# Plan: HKY-5 Cloud Lifecycle

Execution plan for the fifth hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on HKY-1 (rules, setup,
lifecycle and clock), [HKY-2](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md) (rink and core
capture), [HKY-3](PLAN_HKY_3_PENALTIES_STRENGTH_AND_OUTCOMES.md) (penalties, strength,
shootout, result) and [HKY-4](PLAN_HKY_4_TIMELINE_AND_CORRECTIONS.md) (Timeline and
corrections).

Status: proposed. Implementation waits until the owner approves (merges) this plan.

---

## 1. Goal

HKY-5 exits when a Hockey event game behaves in the cloud the way a Basketball event game
does:

- a signed-in recorder's Hockey game binds to a cloud game, uploads its events and keeps
  syncing while it is played, offline included, with the same conflict and recovery
  handling as Basketball,
- personal games and team games both work. A team game snapshots the team roster, and
  team viewers and scorers see it in Cloud Games,
- a team owner or admin can finalize a finished game. The server checks the primary
  recording, works out the final score itself, publishes the canonical record, and locks
  it,
- a finalized game can be reopened with a reason, corrected by its recorder, and
  finalized again, with every publication kept in history,
- Hockey team rules and Starter/Bench and goalie defaults are saved per team, and
  personal rules defaults per account,
- a release handshake keeps an older client and an older database from talking past each
  other. Without the server functions, Hockey stays local-only and says why.

Not in HKY-5:

- the Hockey Summary (overview, skaters, goalies, maps), which is HKY-6A. Until then a
  cloud game opens to Game Info, and its recorder still has the tracker's Timeline,
- `hky_*` aggregates and the five stats destinations (HKY-6B),
- the production release stage change and the full regression record (HKY-6C),
- line combinations (module HKY-M3, §7 Q6),
- Baseball and Football cloud work. Their own phases (BSB-6, FBE) add them.

---

## 2. Slices

Each slice is its own PR. Migration numbers are taken when each PR opens: today the
latest is `071_baseball_team_settings.sql`, so HKY-5A would take 072 unless another
program merges one first.

### HKY-5A Server: register Hockey and add its wrappers

One migration. It opens the shared event-platform cores to Hockey, adds the Hockey
finalization policy, and adds fixed Hockey wrappers like Basketball's 056-061 and 067.

- **Allow-lists, Hockey only** (§7 Q1):
  - `is_event_platform_sport` (051) adds `'hockey'`,
  - the canonical publication `sport_id` check (054/055) is replaced with one that adds
    `'hockey'`, staged `NOT VALID` and then validated (the 050/051 and 054/055 pattern),
  - the setup-snapshot gate in `bind_event_game_v2` (069) accepts Hockey setup version 1.
    The server still stores the snapshot without parsing it, as for the other sports,
  - the aggregate-source guard (060) is not widened. That is HKY-6B, and it needs a
    Hockey completion predicate (§6).
- **Hockey policy functions** (plpgsql over the primary recorder's active events):
  - `is_hockey_primary_stream_ended(game, recorder)`: the latest of `hockey.match_ended`,
    `hockey.match_abandoned`, `hockey.match_suspended` and `hockey.match_reopened` is an
    end or an abandon,
  - `validate_hockey_finalization_policy(game, recorder)` returns the tracked and
    opponent scores:
    - goals are `hockey.shot` events with `outcome = 'goal'`, counted for their
      `team_side`, plus `hockey.score_adjustment` deltas (1 or -1),
    - shootout: the winner gets one goal added, the HKY-3C final-score rule (§7 Q3),
      but only when the shootout is decided by the same rule as `refreshHockeyShootout`.
      The policy counts active `hockey.shootout_attempt` events (current revision) per
      side, attempts taken and goals, and reads `rulesSnapshot.shootout.rounds` from the
      stored immutable setup snapshot:
      - while neither side has taken more than `rounds` attempts, a side has won once its
        goals exceed the other side's goals plus that side's attempts left in the rounds
        (an early clinch),
      - after that (sudden death), a side has won only after a complete round, with
        equal attempts taken and unequal goals,
      - otherwise there is no winner, even with unequal goals: a reasoned early end
        part way through the rounds or before the answering sudden-death attempt, or an
        abandon. Then no goal is added and the recorded regulation and overtime score is
        published, which is the local result (a tie) and follows §7 Q2. Unequal totals
        alone never decide the shootout,
      - the rule reads only counts, so it does not depend on attempt order. A missing or
        malformed `rounds` refuses finalization,
    - it refuses malformed scoring payloads, wrong `team_side` values and negative or
      overflowing scores, as the Basketball policy does,
    - a tie without a shootout is accepted: Hockey rules allow ties, and the tracker
      already decides whether a game can end tied. The server does not re-read the rules
      snapshot.
- **Shared dispatch**: `get_event_finalization_readiness` (057) and `finalize_event_game`
  (058) gain an `elsif p_sport_id = 'hockey'` branch. Both are re-created from their
  current definitions (057 and 058; 064 did not replace them), changing only that branch.
- **Fixed Hockey wrappers**, each a thin call into the existing private core with the
  sport fixed to `'hockey'`:
  - `bind_hockey_event_game_v5` (team roster binding and deleted-player recovery, 067),
  - `get_hockey_game_recorders`, `get_hockey_primary_recorder_history`,
    `set_hockey_primary_recorder` (053/057),
  - `get_hockey_finalization_readiness`, `get_hockey_canonical_publication`,
    `finalize_hockey_event_game` (schema version 1), `reopen_hockey_event_game` (reason
    required), `get_hockey_canonical_publication_history` (055/058/059),
  - the three manager conflict-preparation wrappers (055/057),
  - `get_hockey_release_capabilities` contract version 1: authenticated, active app
    access, every table and fixed RPC present. Same shape as 061.
- Roles are unchanged: owners and admins finalize, reopen and pick the primary; scorers
  record; viewers read. Upload, checkpoint and conflict RPCs are the shared ones, and
  they already check `is_event_platform_sport`.
- Legacy Hockey stat-grid games stay on aggregate sync. `requires_canonical_event_finalization`
  (055) only applies to games with a setup snapshot, so they are unaffected.

The owner applies the migration before the HKY-5B client ships. The handshake keeps the
client local-only until it does.

### HKY-5B Client: sync, recorders, finalize and reopen

- **Transport**: `src/lib/hockey/cloudSync.ts` adds a Hockey adapter to the shared
  `EventCloudTransportAdapter` registry (`eventCloudTransportAdapters.ts`):
  - binding RPC `bind_hockey_event_game_v5`,
  - setup snapshot is `sportState.setup`; participants are the setup participants, with
    `source_player_id` for tracked players of a team game (the Basketball rule),
  - conflict revision policy `advance` (the Basketball choice),
  - recovery error, rebuild and quarantine from the shared transport.
- **Routing**: `cloudSyncRouteForState` gains `'hockey_events'` for complete Hockey event
  games, and `GameContext` dispatches it. Legacy Hockey games keep `'aggregate'`. Running
  clocks sync as Basketball's do (BKE-6D3): events upload as they are recorded.
- **Cloud policy** per game (the BKE-5C3 pattern): `automatic` or `local_only`, stored in
  `cloudSync.eventCloudPolicy`. A malformed policy fails closed. A game made before
  HKY-5B has no policy and stays local-only, with Enable cloud sync in the Game menu
  (§7 Q4).
- **Setup**: `HockeyGameSetup` checks the release handshake when the recorder is signed
  in. It offers Cloud or This device only; a failed handshake explains why and offers
  Retry or This device only. The "does not sync yet" note goes away.
- **Cloud Games and resume**: Hockey games appear in Cloud Games. Opening one resumes the
  recorder's matching parked binding first, as Basketball does. `gameParking`,
  `sportNavigation` and the legacy-row selector learn Hockey event games.
- **Game Info**: for a Hockey event game, owners and admins get the recorder list,
  primary selection, finalization readiness (with the server's reasons), Finalize,
  publication history and Reopen with a reason. Scorers and viewers see the score,
  status and compact recorder presence. The Basketball recorder and finalization panels
  are reused through a sport label and a set of Hockey RPC names, not copied.
- **Finalize**: the client shows the final score the server will publish, from the
  primary stream (the HKY-3C result), before the owner confirms. If the server's score
  differs, the server's wins and the client says so.
- **Reopen**: the server invalidates the publication and unlocks primary selection. The
  recorder's matching parked binding then appends `hockey.match_reopened` with the reason
  (the local Reopen that already exists). Corrections use the HKY-4 Timeline, and the
  owner finalizes again explicitly. There is one reopen kind (§7 Q5).
- **Finalized games are read-only**: the tracker and Timeline refuse capture and
  corrections on a finalized game until Reopen, with that reason.

### HKY-5C Settings persistence and Team Manage

- **Migration**: Hockey settings validators plus `save_hockey_user_settings_revisioned`
  and `save_hockey_team_settings_revisioned` over the shared revisioned core (062 and
  071 pattern):
  - personal: the exact HKY-1 settings (`settingsSchemaVersion`, `baseProfile`,
    `ruleOverrides`),
  - team: the same plus `lineupDefaults` (HKY-1 `HockeyLineupDefaults` v1: up to six
    starters, starting and backup goalie; ids must be active players on the team),
    owner/admin only, team season sport must be hockey,
  - `get_hockey_release_capabilities` contract version 2 adds `settingsContractVersion`.
- **Client**:
  - team settings through the shared `useSportTeamSettings` hook with a Hockey adapter
    (Baseball's pattern),
  - personal settings through the account-scoped cache and CAS flow Basketball uses,
    offline edits pending until they reconcile,
  - Team Manage gets a Hockey panel: rules profile and overrides, and Starter/Bench plus
    starting and backup goalie defaults. Scorers and viewers review it read-only,
  - Settings → Sports → Hockey gets the personal rules default,
  - Hockey setup resolves personal or team settings into the match (the HKY-1 hierarchy),
    and prefills the opening lineup once from team defaults. Recorder edits in setup
    always win, and nothing writes back to the team.

HKY-0 put the Team Manage panel in HKY-6C. It moves here because saving settings that
nothing can edit cannot be tested by the owner (§7 Q6).

---

## 3. Data and compatibility rules

- No Hockey event type, payload, setup or rules change. Events upload exactly as stored.
- Soccer and Basketball functions, wrappers and capability contracts are unchanged. The
  two shared dispatch functions are re-created with one added branch each.
- Baseball and Football stay off the event platform. Their allow-list entries are added
  by their own cloud phases, each with its own finalization policy (§7 Q1).
- Legacy Hockey stat-grid games keep aggregate sync and are never treated as event games.
- Existing local Hockey event games keep working local-only. Nothing uploads without the
  recorder choosing cloud.
- The cloud policy and binding metadata stay outside gameplay fingerprints, as for
  Basketball.
- Server scores come from the primary stream only. Other recorders' streams stay
  isolated.

---

## 4. Cross-sport items touched

- **XS-2 (event-sport registration)**: Hockey is the first new sport on the event
  platform. It widens the allow-lists for Hockey only and records the steps in §8, so
  Baseball and Football can repeat them.
- **XS-3 (legacy vs event capability)**: Hockey stays in
  `LEGACY_AGGREGATE_CLOUD_SPORT_IDS` for legacy games; event games route by
  `sportGameState`.
- **XS-9 (lineup defaults)**: Hockey team settings carry `lineupDefaults` in the
  Basketball/Soccer shape, plus goalies.
- The Basketball recorder and finalization panels become sport-parameterized instead of
  being copied. Only presentation is shared: source preparation, canonical parsing and
  replay validation, and reopen policy (Basketball's anchored-clock modes) stay behind
  per-sport adapters or callbacks, never a rename of RPC strings. Basketball behavior
  must not change; its existing tests cover it.

---

## 5. Regression

`docs/REGRESSION_HKY_5_CLOUD_LIFECYCLE.md` when implementation lands:

- server (SQL run against a branch or local database where available, otherwise by the
  owner after applying): bind, upload, checkpoint, conflict and recovery for a Hockey
  game; the policy's score for regulation, overtime, shootout, score adjustments and
  removed goals; refusals for an unfinished stream and malformed payloads;
  server and client parity on the same fixtures for the shootout: an early clinch, a
  sudden-death win after a complete round, a reasoned end after only the first attempt
  of a three-round shootout (goals 1-0, no winner, published 0-0), and a reasoned end
  after the first sudden-death goal before the answering attempt (no winner, the
  recorded score); finalize, reopen with reason, re-finalize and history; viewer and scorer
  refusals; Soccer and Basketball readiness and finalize unchanged,
- client unit tests: adapter payloads, routing for event, legacy and local-only games,
  the cloud policy parser, the handshake parser (exact, older, newer), Game Info gating
  by role, finalized-game refusals, settings parsing and CAS conflicts,
- browser at phone size against the dev server: setup with Cloud, play, sync status,
  Cloud Games listing, Game Info finalize and reopen (with the migration applied where
  possible),
- two-device live check by the owner after deploy: one recorder, a viewer on a second
  device, finalize, reopen, correct and re-finalize. It is recorded as pending until
  done,
- HKY-1 to HKY-4 fixtures replay unchanged; Soccer, Basketball and Baseball suites pass,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 6. Risks

- **Re-creating shared functions.** `get_event_finalization_readiness` and
  `finalize_event_game` are shared by Soccer and Basketball. The migration copies their
  latest bodies and adds one branch; a diff against 057/058 is part of the PR.
- **Server score versus client result.** The policy re-derives the score in SQL. A
  difference from the HKY-3C result (for example a shootout edge case) would block or
  change a publication. Policy tests use the same fixtures as the client result tests,
  and Finalize shows both if they differ.
- **Abandoned and suspended games.** Hockey has separate `match_abandoned` and
  `match_suspended` events, where the other sports use a reason on `match_ended`. The
  policy treats abandon as terminal and suspend as not (§7 Q2).
- **Aggregate completion.** The shared aggregate snapshot check looks for
  `match_ended` with `reason = 'completed'`. Hockey ends a completed game with a null
  reason, so HKY-6B must add a Hockey completion predicate before widening that guard.
  HKY-5 leaves it alone.
- **Migration order.** A client deployed before the migration must stay local-only. The
  handshake does this, and the setup screen says so.

---

## 7. Owner Questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | HKY-0 and BSB-0 suggested widening the event-platform allow-lists for all three new sports in one migration. Doing that now would open the cloud paths for Baseball and Football before they have a finalization policy. Widen for Hockey only? | Yes. Hockey only; Baseball and Football each add themselves with their own policy |
| Q2 | Which ends can be finalized: a completed game, an ended-early game (ended with a reason), an abandoned game? | All three, with the score as recorded (the Soccer and Basketball rule). A suspended game cannot be finalized until it is resumed and ended |
| Q3 | A shootout winner: publish the final score with one goal added for the winner (3-2 after a 2-2 shootout)? | Yes, the HKY-3C result, only for a decided shootout. A shootout ended or abandoned before it is decided publishes the recorded score with no goal added. Player totals never include it |
| Q4 | Hockey games recorded before HKY-5B: leave them on this device, with an Enable cloud sync option in the Game menu? | Yes. Nothing uploads unless the recorder enables it |
| Q5 | Reopen: one kind (reopen with a reason; the recorder then corrects or keeps playing), or Basketball's two (correct records only, or resume the game)? | One kind. Hockey's local Reopen already lets the recorder correct or resume, and the owner re-finalizes explicitly |
| Q6 | Move the Team Manage Hockey rules and lineup panel from HKY-6C into HKY-5C, so saved settings can be edited and tested? Line combinations stay a later module | Yes |
| Q7 | Slices: HKY-5A server migration, HKY-5B client sync and lifecycle, HKY-5C settings and Team Manage, each its own PR? | Yes |

---

## 8. Delivery Record

Filled in as each slice lands.
