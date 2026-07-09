# Feature 5 Plan: Auto 2/3 with Manual Override Chip

> **Status:** Implemented.
>
> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](../DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](../PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). **Depends on F1**
> ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md)) — it
> extends `CourtEventPopup`.

**Goal:** In the court event popup, the 2-pointer/3-pointer value auto-detected from the
tap location can be **overridden with one tap** before logging Made/Missed — for
foot-on-the-line, deep heaves, or when the tap landed slightly off.

**Architecture:** Add a `2PT / 3PT` segmented chip to `CourtEventPopup`, defaulted from
`isThreePointer(x, y)`. The **chosen** value (not the raw location) drives the recorded
`shotType` and therefore the stat (`2pt`/`3pt`(`_miss`)) and the marker's `zone`. The tap
`(x, y)` is stored as-is. No data-model change.

**Tech Stack:** React + TypeScript, existing `courtGeometry` (`isThreePointer`,
`classifyShotZone`). Vitest for a small zone-coherence helper. No new dependencies.

---

## 1. Problem & current state (post-F1)

F1's `CourtEventPopup` shows `Detected: 2-pointer` / `3-pointer` from `isThreePointer(x,y)`
and, on Made/Missed, records `ADD_SHOT` with that `shotType`. There's **no way to correct
the value** when the auto-detection is wrong:
- A shooter with a **foot on the line** (officially a 2) tapped just outside the arc.
- A **half-court heave** or a tap placed imprecisely.
- The scorer's table ruled differently than the tapped location implies.

Today the only fix is undo + re-tap more carefully, or accept the wrong value. F5 adds an
inline override.

## 2. Design

### 2.1 The chip

In `CourtEventPopup`, next to the detected-value line:

```
┌─────────────────────────────┐
│  #23 Jordan                  │
│  Shot value:  [ 2PT ]  3PT   │  ← segmented; default = isThreePointer(x,y)
│  ┌──────────┐ ┌──────────┐   │
│  │   MADE   │ │  MISSED  │   │
│  └──────────┘ └──────────┘   │
│  Off Reb · Def Reb · …       │
└─────────────────────────────┘
```

- Default selection = `isThreePointer(x, y) ? '3pt' : '2pt'`.
- The chip is only relevant to **Made/Missed** (shots). It has no effect on the secondary
  rebound/steal/block/assist actions.
- On Made/Missed, the recorded `ShotRecord.shotType` = the **chip's** value (overriding the
  raw location classification).

### 2.2 Keep the tapped location; force the value

The marker stays exactly where the user tapped (`x, y` unchanged) — it reflects where the
shot was taken; the chip reflects how it's **scored**. So a marker can legitimately sit
just outside the arc but be recorded as a 2 (foot on the line), or vice versa.

### 2.3 Zone coherence (the one subtle bit)

`ShotRecord.zone` (`restricted | paint | mid_range | three`) feeds the `ShootingSummary`
zone breakdown. If we override the 2/3 value but leave `zone` as the raw location zone, the
summary can show an incoherent row (e.g. a "3PT" shot counted under `mid_range`, or a "2PT"
shot counted under `three`). To keep the summary coherent, derive `zone` from the **chosen**
value:

```ts
// src/lib/shotChartViews.ts (or courtGeometry.ts) — small pure helper
export function zoneForForcedShotType(
  x: number, y: number, shotType: '2pt' | '3pt'
): ShotZone {
  if (shotType === '3pt') return 'three'
  const z = classifyShotZone(x, y)        // restricted | paint | mid_range | three
  return z === 'three' ? 'mid_range' : z  // a forced 2 can't be in the 'three' zone
}
```

- Forced **3PT** → `zone = 'three'`.
- Forced **2PT** → keep the location zone, but if that zone was `three`, fall back to
  `mid_range` (the nearest 2-point zone).
- When the chip matches the auto-detection (the common case), this returns exactly
  `classifyShotZone(x, y)` — no behavior change.

### 2.4 Override scope

The chip is **per-shot**: each new court tap re-runs `isThreePointer` and resets the chip to
the detected default. There is **no sticky override** — you override only the shot that
needs it, then the next tap auto-detects again.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/components/shot-chart/CourtEventPopup.tsx` | **Modify** — add the `2PT/3PT` chip (state defaulted from `isThreePointer`); use the chosen value for `shotType`; compute `zone` via `zoneForForcedShotType`. |
| `src/lib/shotChartViews.ts` (or `src/components/shot-chart/courtGeometry.ts`) | **Modify** — add `zoneForForcedShotType(x, y, shotType)`. |
| `src/lib/shotChartViews.test.ts` (or a geometry test) | **Modify/Create** — unit-test the helper. |

No `types.ts`/reducer change — `ADD_SHOT` already takes `shotType` + `zone`.

## 3. Implementation tasks (bite-sized)

### Task 1: Zone-coherence helper + test (TDD)

- [x] **Add a test** for `zoneForForcedShotType`:
  - forced `'3pt'` at any `(x,y)` → `'three'`.
  - forced `'2pt'` at a location that classifies as `'three'` → `'mid_range'`.
  - forced `'2pt'` at a paint/restricted/mid location → that same zone.
  - chip matches detection → equals `classifyShotZone(x,y)`.
- [x] Run the test. Expected: FAIL (helper missing). Failed as expected.
- [x] **Implement `zoneForForcedShotType`** per §2.3.
- [x] Run the test. Expected: PASS. `pnpm.cmd test src/components/shot-chart/courtGeometry.test.ts`
- [x] **Commit:** `feat: add zoneForForcedShotType helper for shot-value override`

### Task 2: 2PT/3PT chip in the popup

- [x] **Modify `CourtEventPopup.tsx`**: add `const [shotType, setShotType] = useState<'2pt'|'3pt'>(isThreePointer(x,y) ? '3pt' : '2pt')`
  and a segmented `2PT / 3PT` control bound to it.
- [x] On **Made/Missed**, build the `ShotRecord` with `shotType` = the chip value and
  `zone = zoneForForcedShotType(x, y, shotType)`; dispatch `ADD_SHOT` (made/missed per the
  button). The secondary actions ignore the chip.
- [x] Re-default the chip whenever a new tap opens the popup (per-shot scope, §2.4).
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass. Build passed; lint passed with existing fast-refresh warnings.
- [ ] Manual: tap just inside the arc → defaults **2PT**; flip to **3PT** → Made →
  `3pt` increments, score +3, marker at the tapped spot, summary counts it under 3-Point;
  tap clearly beyond the arc → defaults **3PT**; flip to **2PT** → counts as a 2 / mid-range.
- [x] **Commit:** `feat: manual 2PT/3PT override in the court event popup`

## 4. Testing

- **Unit:** `pnpm test` for `zoneForForcedShotType`.
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Default value matches the tap location (inside arc → 2PT, outside → 3PT).
  - Overriding to 3PT records `3pt` (+3 to score) and the summary's 3-Point cell; marker
    stays where tapped.
  - Overriding to 2PT on an outside-arc tap records `2pt` and counts under mid-range (not 3).
  - Override is per-shot: the next tap re-detects from its own location.
  - The chip doesn't affect rebound/steal/block/assist.
  - Undo reverts the recorded value correctly.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Summary incoherence (3PT shot in a 2-pt zone) | `zoneForForcedShotType` keeps `zone` consistent with the chosen value (§2.3). |
| Users expect the marker to move when overriding | By design the marker stays at the tap; the chip changes scoring only — documented; matches "where it was taken vs how it's scored." |
| Accidental override persists to later shots | Per-shot scope: the chip resets to the detected default on every new tap (§2.4). |

## 6. Out of scope

- Editing a shot's value **after** logging (use undo + re-log in v1).
- Moving/dragging an existing marker (separate future idea).
- Free throws (not court shots).

## 7. Pre-handoff design decisions — RESOLVED

All F5 decisions are settled (signed off; every one confirmed as recommended).

### A. Behavior

- **D1 — Marker location on override.** Keep the **literal tap location** (`x,y` unchanged);
  the chip changes only how the shot is **scored**.
- **D2 — Zone coherence.** Derive `zone` from the chosen value via `zoneForForcedShotType`
  (forced 3PT → `three`; forced 2PT in a `three` location → `mid_range`; otherwise the
  location zone) — keeps the `ShootingSummary` coherent.
- **D3 — Override scope.** **Per-shot** — the chip resets to the auto-detected default on
  every new court tap (no sticky override).

### B. UI

- **D4 — Chip placement / style.** A `2PT / 3PT` segmented control near the detected-value
  line, active value highlighted, default = detected.
- **D5 — Override indicator.** Light touch — highlight the chosen segment; an explicit
  "(overridden)" label is optional polish.

### C. Acceptance & tests

- **D6 — Acceptance + tests.** Unit: `zoneForForcedShotType` matrix. Manual: the §4 cases
  (default matches location; override changes stat/score/summary; marker stays; per-shot
  reset; secondary actions unaffected; undo works).

### D. Explicitly out of F5
Post-log editing, marker drag, free throws. F5 only adds the pre-log 2/3 override to the
F1 popup.
