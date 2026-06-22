# Court Event Capture — Enhancements Roadmap (F5–F11)

> **For agentic workers:** This is a roadmap of **named, ordered, phased sketches** for
> the follow-on enhancements to the Court Event Capture model introduced in
> [PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md). Each
> item is a sketch (goal, dependency, phases, files, effort, open question), not yet a
> full task-by-task plan. When one is picked up, expand it to a full plan with a
> "Pre-handoff design decisions" section like F1–F4.

All of these **depend on F1** (the single-page tracker + `CourtEventPopup`). None changes
the data model — they map to existing dispatches (`ADD_SHOT`, `INCREMENT_STAT`) and reuse
`BasketballCourt` / `ShootingSummary` / `PlayerSelectorStrip`.

## Origin

These are the user's six requested enhancements plus the deferred "Option B" hybrid:

| Roadmap id | Origin | Theme |
|---|---|---|
| F5 | suggestion #3 | Auto 2/3 with manual override |
| F6 | suggestion #1 | In-popup player confirm/switch |
| F7 | suggestion #2 | Assist-linking on a made shot |
| F8 | suggestion #5 | Live per-player line in the popup |
| F9 | suggestion #4 | Rebound-after-miss chained prompt |
| F10 | suggestion #6 | Shot sequence numbers / recency |
| F11 | Option B | Hybrid 1-tap quick buttons for blk/stl/ast |

## Recommended implementation order (whole program)

Foundation first, then attribution-correctness wins, then progressive polish, with the
speculative hybrid gated on real use. F4 (resume scores) is independent and can slot in
anytime as a quick win.

```
F1  Single-page tracker + Court Event Capture (foundation)
 ├─ F2  Per-player / team shot filtering        (high value once the court is central)
 ├─ F5  Auto 2/3 override chip                   (tiny; correctness)
 ├─ F6  In-popup player confirm/switch           (attribution safety; user's top pain)
 ├─ F3  Cloud-saved game shot review             (after capture + filtering are stable)
 ├─ F7  Assist-linking on a made shot            (medium; undo coordination)
 ├─ F8  Live per-player line in popup            (small; context)
 ├─ F9  Rebound-after-miss prompt                (needs live tuning; opt-in)
 ├─ F10 Shot sequence numbers / recency          (cosmetic)
 └─ F11 Hybrid quick buttons (Option B)          (only if testing shows blk/stl/ast need 1-tap)
F4  In-progress scores on resume UI              (independent; quick win, anytime)
```

**Why this order:** F5 and F6 are cheap and directly improve the core capture loop
(correct shot value; correct/confirmed player) — do them right after F1. F2 and F3 are
the originally-planned chart features and are most valuable once the court is the primary
surface. F7–F10 are progressive polish. F11 is intentionally last: build it only if live
testing shows the extra tap for block/steal/assist is a real friction, to avoid
speculative UI.

---

## F5 — Auto 2/3 with manual override chip

> **Expanded to a full plan:** [PLAN_F5_AUTO_2_3_OVERRIDE.md](PLAN_F5_AUTO_2_3_OVERRIDE.md)
> (tasks + pre-handoff decisions).

**Goal:** In `CourtEventPopup`, the location-detected shot value (`isThreePointer(x,y)`)
is shown and can be **overridden** with one tap (foot-on-the-line, deep heave, or scorer
disagreement) before logging Made/Missed.

**Depends on:** F1 (popup exists). **Effort:** XS.

**Phases:**
- **P1:** Add a `2PT / 3PT` segmented chip to the popup, defaulted from
  `isThreePointer(x,y)`. The chosen value (not the raw location) drives `shotType` and the
  resulting `2pt`/`3pt`(`_miss`) stat. Location `(x,y)` is still stored as tapped.

**Key files:** `CourtEventPopup.tsx`. No data change.

**Open question:** If the user overrides 2↔3, do we keep the literal tap location (marker
sits where tapped, value forced) — recommended yes — or nudge the marker? Default: keep
location, force value.

---

## F6 — In-popup player confirm / switch

> **Expanded to a full plan:** [PLAN_F6_IN_POPUP_PLAYER_SWITCH.md](PLAN_F6_IN_POPUP_PLAYER_SWITCH.md)
> (tasks + pre-handoff decisions).

**Goal:** The popup header shows the selected player and lets you **switch attribution**
before logging — the strongest fix for "I logged it to the wrong/at-the-time-unclear
player." Confirms who gets the stat at the moment of the event.

**Depends on:** F1. **Effort:** S.

**Phases:**
- **P1:** Header shows `#num Name` of the active player (read-only label).
- **P2:** Make the label a control: a compact dropdown / mini player list (reuse
  `PlayerSelectorStrip` data) to pick a different player. Decide whether picking changes
  the **global** active player (sticky, subsequent taps follow) or only **this** event.

**Key files:** `CourtEventPopup.tsx`, reuse `PlayerSelectorStrip` / `sortTeamPlayersFirst`.

**Open question:** Switching scope — global (recommended: updates `activePlayerId` so the
sticky strip and next taps follow) vs. one-off (this event only). Default: global.

---

## F7 — Assist-linking on a made shot

**Goal:** After a **Made** shot, optionally credit the assisting teammate in the same
gesture (assists are almost always tied to a made FG).

**Depends on:** F1; pairs naturally with F6 (player picker reuse). **Effort:** M
(undo coordination is the real work).

**Phases:**
- **P1:** After Made, show an optional "Assisted by …" picker (skippable / "no assist").
  Picking a teammate dispatches `INCREMENT_STAT(assister, 'ast')` in addition to the shot.
- **P2:** Undo coordination — ensure undoing the shot and the linked assist behaves
  predictably (either a single combined undo step or two independent steps with clear
  ordering). Polish: default to no-assist, surface recent passers first.

**Key files:** `CourtEventPopup.tsx`, possibly `GameContext.tsx` (a combined action or
careful sequential dispatch + `actionLog` linkage), undo logic.

**Open question:** One combined undo (shot+assist revert together) vs. two separate undo
steps. Default: two steps (simpler, matches existing per-action undo), documented.

---

## F8 — Live per-player line in the popup

**Goal:** Show the selected player's quick stat line (e.g. `12 pts · 5 reb · 3 ast`) in
the popup header for instant context while logging.

**Depends on:** F1; nice with F6. **Effort:** XS.

**Phases:**
- **P1:** Compute the compact line from `player.stats` using existing helpers
  (`keyStatIds` in `sports.ts` + `src/lib/statDisplay.ts`) and render it under the player
  name in `CourtEventPopup`.

**Key files:** `CourtEventPopup.tsx`, `src/lib/statDisplay.ts` (reuse).

**Open question:** Which stats to show — sport `keyStatIds` (default) vs. a shot-specific
set (pts/FG/reb/ast). Default: `keyStatIds`.

---

## F9 — Rebound-after-miss chained prompt

**Goal:** A missed shot is usually followed by a rebound; optionally chain a quick
"Rebound? Off / Def / none" prompt right after **Missed** to capture the sequence without
a second court tap.

**Depends on:** F1. **Effort:** S–M.

**Phases:**
- **P1:** After Missed, present a follow-up mini-prompt (Off / Def / Skip). Off/Def
  dispatch `oreb`/`dreb` for the chosen player.
- **P2:** A setting to enable/disable the chain (some coaches will find it naggy);
  consider whether the rebound can be attributed to a different player/team in the same
  prompt (reuse F6 picker).

**Key files:** `CourtEventPopup.tsx`, `src/context/SettingsContext.tsx` (toggle).

**Open question:** Default on or off? Default: **off** (opt-in), to avoid slowing users
who don't want it.

---

## F10 — Shot sequence numbers / recency highlight

**Goal:** Optionally number shot markers chronologically and/or highlight the most recent
N, so a coach can reconstruct game flow.

**Depends on:** F1; orthogonal to capture. **Effort:** S.

**Phases:**
- **P1:** Render order/recency in `BasketballCourt` (markers already carry `timestamp` and
  array order). Either small sequence numbers or a fade for older shots.
- **P2:** A toggle to show/hide numbering (keep the default clean).

**Key files:** `BasketballCourt.tsx`, `ShotChartPanel.tsx`.

**Open question:** Sequence numbers (precise but busier) vs. recency fade (cleaner).
Default: recency highlight off by default, numbering behind a toggle.

---

## F11 — Hybrid quick buttons for block / steal / assist (Option B)

**Goal:** For coaches who log many blocks/steals/assists, add dedicated **1-tap** buttons
next to the court (no popup), while keeping the popup's secondary row. Restores the
1-tap speed those events had before Option A.

**Depends on:** F1 (and ideally after live testing of Option A). **Effort:** S.

**Phases:**
- **P1:** A compact quick-button row (Steal / Block / Assist, maybe Off/Def Reb) adjacent
  to the court that dispatches `INCREMENT_STAT` for the active player in one tap.
- **P2:** A setting to choose input mode — **A** (popup only), **B** (quick buttons only),
  or **both** — and reconcile with the popup's secondary row to avoid duplication.

**Key files:** `ShotChartPanel.tsx`, `src/context/SettingsContext.tsx`.

**Open question:** Ship B as always-on extra buttons vs. a user setting. Default: a
setting (A default), built **only if** Option A testing shows the extra tap is real
friction.

---

## Notes

- **No data-model changes** across F5–F11; all map to existing `ADD_SHOT` /
  `INCREMENT_STAT` and existing stat ids.
- **F2/F3 interplay:** F2's `shotsForSelection` filtering and F3's all-recorder review
  apply to the inline court from F1 regardless of these enhancements; F5–F11 only change
  the *capture* experience, not the stored shape.
- When promoting any item to active work, expand it into its own
  `PLAN_F{n}_*.md` with full tasks + a Pre-handoff design decisions section (same format
  as F1–F4).
