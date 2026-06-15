/**
 * Skip delete+replace `shot_chart` sync when hydration left unmapped cloud rows and
 * the user has no local chart yet — a full replace would wipe those orphan rows.
 */
export function shouldSkipShotChartCloudSync(
  shotChartHydrationDroppedRows: number,
  localShotChartLength: number
): boolean {
  return shotChartHydrationDroppedRows > 0 && localShotChartLength === 0
}
