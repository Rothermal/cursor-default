/**
 * ## Shot chart court coordinates (feet)
 *
 * `BasketballCourt` draws and reports taps in this single space. **`ShotRecord.x` /
 * `ShotRecord.y` must use the same numbers** with no extra flip, scale, or offset.
 *
 * - **Origin `(0, 0)`:** center of the rim.
 * - **+y:** toward the half-court line (deeper on the half-court diagram).
 * - **Baseline** (out of bounds behind the hoop): **negative y** (`BASELINE_Y` in `courtGeometry.ts`).
 *
 * When creating a shot from a tap, pass `(x, y)` into `isThreePointer` and `classifyShotZone`
 * from `src/components/shot-chart/courtGeometry.ts` unchanged.
 */
export {}
