# Court Event Capture - Enhancements Roadmap (F5-F13)

> **For agentic workers:** This is the roadmap for follow-on enhancements to the Court
> Event Capture model introduced in [PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md).
> F5, F6, F7, F8, F9, and F12 are implemented. F10 is no longer needed as a
> standalone visible-numbering feature and is superseded by F13. F11 and F13 are both
> held pending further user feedback before any build work. F13 is drafted for review in
> [PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md](PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md).

F5-F12 depend on F1 (the single-page tracker + `CourtEventPopup`) and avoid data-model
changes by mapping to existing dispatches (`ADD_SHOT`, `INCREMENT_STAT`). F13 is the first
planned court-capture feature that intentionally considers durable shot metadata and edit
semantics.

## Origin

These are the user's six requested enhancements plus deferred/new follow-ups:

| Roadmap id | Origin | Theme |
|---|---|---|
| F5 | suggestion #3 | Auto 2/3 with manual override |
| F6 | suggestion #1 | In-popup player confirm/switch |
| F7 | suggestion #2 | Assist-linking on a made shot |
| F8 | suggestion #5 | Live per-player line in the popup |
| F9 | suggestion #4 | Rebound-after-miss chained prompt |
| F10 | suggestion #6 | Shot sequence numbers / recency (superseded by F13) |
| F11 | Option B | Hybrid 1-tap quick buttons for blk/stl/ast |
| F12 | user idea | Recent-events undo popup (last ~5 events, undo from top) |
| F13 | user idea | Shot detail + linked metadata + edit modal |

## Recommended Implementation Order

Foundation first, then attribution-correctness wins, then progressive polish, with the
speculative hybrid gated on real use.

```text
F1  Single-page tracker + Court Event Capture       (implemented)
 |-- F2  Per-player / team shot filtering           (implemented)
 |-- F3  Cloud-saved game shot review               (implemented; two-user QA pending)
 |-- F5  Auto 2/3 override chip                     (implemented)
 |-- F6  In-popup player confirm/switch             (implemented)
 |-- F12 Recent-events undo popup                   (implemented; unblocks F7)
 |-- F7  Assist-linking on a made shot              (implemented)
 |-- F8  Live per-player line in popup              (implemented)
 |-- F9  Rebound-after-miss prompt                  (implemented; opt-in)
 |-- F10 Shot sequence numbers / recency            (superseded; no standalone work)
 |-- F13 Shot detail + linked metadata/edit modal   (hold pending user feedback)
 `-- F11 Hybrid quick buttons (Option B)            (hold pending user feedback)
F4  In-progress scores on resume UI                 (implemented; cloud-list QA pending)
```

**Remaining work:** F11 and F13 are both paused. Revisit only after further user feedback
clarifies whether quick non-shot buttons or shot detail/editing are worth prioritizing.

**Why this order:** F12 gives F7's two-step assist undo a visible event list without a
reducer change. F13 is the natural successor to F7/F9 because it turns their
adjacent-but-unlinked stat increments into durable shot metadata and an eventual edit
surface. Both are intentionally held now: build F11 only if live testing shows the extra
tap for block/steal/assist is real friction, and build F13 only if shot detail/editing
proves important enough for the larger data-model work.

---

## F5 - Auto 2/3 with manual override chip

> **Expanded to a full plan:** [PLAN_F5_AUTO_2_3_OVERRIDE.md](PLAN_F5_AUTO_2_3_OVERRIDE.md).
> **Status:** Implemented.

**Goal:** In `CourtEventPopup`, the location-detected shot value (`isThreePointer(x,y)`)
is shown and can be overridden with one tap before logging Made/Missed.

**Key files:** `CourtEventPopup.tsx`. No data change.

**Resolved:** Keep the literal tap location and force the selected shot value when the user
overrides 2PT/3PT.

---

## F6 - In-popup player confirm / switch

> **Expanded to a full plan:** [PLAN_F6_IN_POPUP_PLAYER_SWITCH.md](PLAN_F6_IN_POPUP_PLAYER_SWITCH.md).
> **Status:** Implemented.

**Goal:** The popup header shows the selected player and lets the scorer switch attribution
before logging.

**Key files:** `CourtEventPopup.tsx`, `PlayerSelectorStrip`, `sortTeamPlayersFirst`.

**Resolved:** Switching in the popup updates the global active player.

---

## F7 - Assist-linking on a made shot

> **Expanded to a full plan:** [PLAN_F7_ASSIST_LINKING.md](PLAN_F7_ASSIST_LINKING.md).
> **Status:** Implemented.

**Goal:** After a made shot, optionally credit a same-side teammate assist in the same
gesture.

**Key files:** `CourtEventPopup.tsx`, `ShotChartPanel.tsx`, `src/lib/assistCandidates.ts`.

**Resolved:** The shot and assist are two separate undo entries, made understandable by
F12's recent-events popup. No reducer/data-model change in F7.

---

## F8 - Live per-player line in the popup

> **Expanded to a full plan:** [PLAN_F8_LIVE_PER_PLAYER_LINE.md](PLAN_F8_LIVE_PER_PLAYER_LINE.md).
> **Status:** Implemented.

**Goal:** Show the selected player's quick stat line in `CourtEventPopup`.

**Key files:** `CourtEventPopup.tsx`, `src/lib/statDisplay.ts`.

**Resolved:** Use existing `formatCompactGameStatLine` output: score, basketball rebounds,
and sport `keyStatIds`.

---

## F9 - Rebound-after-miss chained prompt

> **Expanded to a full plan:** [PLAN_F9_REBOUND_AFTER_MISS_PROMPT.md](PLAN_F9_REBOUND_AFTER_MISS_PROMPT.md).
> **Status:** Implemented.

**Goal:** After a missed shot, optionally prompt for Off Reb, Def Reb, or No rebound.

**Key files:** `CourtEventPopup.tsx`, `ShotChartPanel.tsx`, `src/lib/reboundPrompt.ts`,
`src/context/SettingsContext.tsx`.

**Resolved:** Default off. Off rebound defaults to the missed-shot side's team
pseudo-player; Def rebound defaults to the opposite side's team pseudo-player. The shot and
rebound stay separate undo entries.

---

## F10 - Shot sequence numbers / recency highlight

> **Status:** No longer needed as a standalone feature. Superseded by
> [PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md](PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md).

**Original goal:** Number shot markers chronologically and/or highlight the most recent N
shots so a coach could reconstruct game flow.

**Resolution:** Do not add visible marker numbers as a standalone overlay. Shot numbering
belongs at the metadata/detail level:

- keep the court visually clean
- assign or derive a shot number for each shot
- show that number in a shot detail modal
- use the same modal as the future correction/edit surface

**Replacement:** F13 shot detail + linked metadata + edit modal.

---

## F13 - Shot detail + linked metadata + edit modal

> **Expanded to a draft plan:** [PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md](PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md).
> **Status:** Held pending further user feedback.

**Goal:** Tap an existing shot marker to inspect the shot event: shot number, shooter,
result/value, zone/location, timestamp/order, and any F7 assist or F9 rebound linked to
that shot. Later phases make those fields editable and update stat totals safely.

**Depends on:** F1, F7, F9, F12. **Effort:** M-L depending on edit/cloud scope.

**Phases:**

- **P1:** Read-only shot details modal with derived shot number and core shot data.
- **P2:** Persist linked metadata on new shots (`sequenceNumber`, `assistPlayerId`,
  `reboundPlayerId`, `reboundStatId`) while still incrementing totals.
- **P3:** Add cloud persistence for linked metadata on `shot_chart`.
- **P4:** Add shot editing for shooter/result/value/assist/rebound with stat-total
  corrections.
- **P5:** Add edit undo/audit polish, likely via a `shot_edit` action-log snapshot.

**Key files:** `ShotRecord` in `src/types.ts`, `GameContext.tsx`, `BasketballCourt.tsx`,
`ShotChartPanel.tsx`, `CourtEventPopup.tsx`, `src/lib/cloudSync.ts`, and a future
Supabase migration.

**Open questions:** sequence assignment vs derived display order; local-first vs
cloud-in-same-PR; edit scope; undo model for edits; whether legacy local action logs should
ever infer F7/F9 links (recommended no).

---

## F11 - Hybrid quick buttons for block / steal / assist (Option B)

> **Status:** Held pending further user feedback.

**Goal:** For coaches who log many blocks/steals/assists, add dedicated one-tap buttons
next to the court while keeping the popup's secondary row.

**Depends on:** F1 and live testing of Option A. **Effort:** S.

**Phases:**

- **P1:** A compact quick-button row (Steal / Block / Assist, maybe Off/Def Reb) adjacent
  to the court that dispatches `INCREMENT_STAT` for the active player in one tap.
- **P2:** A setting to choose input mode: A (popup only), B (quick buttons only), or both.

**Key files:** `ShotChartPanel.tsx`, `src/context/SettingsContext.tsx`.

**Open question:** Ship B as always-on extra buttons vs. a user setting. Default: a
setting, built only if Option A testing shows real friction.

---

## F12 - Recent-events undo popup

> **Expanded to a full plan:** [PLAN_F12_RECENT_EVENTS_UNDO.md](PLAN_F12_RECENT_EVENTS_UNDO.md).
> **Status:** Implemented before F7.

**Goal:** Replace silent single Undo with a popup listing the last few events in plain
language so the user can see and undo recent actions.

**Key files:** `src/lib/actionLogLabels.ts`, `src/components/RecentEventsPopup.tsx`,
`src/pages/GameTracker.tsx`.

**FUTURE NOTE - Option C (arbitrary out-of-order undo):** undoing a middle event is unsafe
with today's stored-`previousValue` LIFO model and needs a bigger refactor (inverse deltas
or event-sourced recompute). Gather usage data first.

---

## Notes

- F5-F12 intentionally avoided data-model changes. They map to `ADD_SHOT`,
  `INCREMENT_STAT`, `UNDO`, and existing stat ids.
- F13 is the planned exception: durable shot metadata and editing likely require
  `ShotRecord`, reducer, cloud sync, and Supabase `shot_chart` changes.
- F2/F3 interplay: F2's `shotsForSelection` filtering and F3's all-recorder review apply
  to the inline court regardless of these enhancements.
- When promoting any item to active work, expand it into its own `PLAN_F{n}_*.md` with full
  tasks and a Pre-handoff design decisions section.
