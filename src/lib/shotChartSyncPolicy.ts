/** Skip full shot-chart replace when hydration left orphan cloud rows and local chart is still empty. */
export function shouldSkipShotChartCloudDeleteReplace(
  shotChartHydrationDroppedRows: number,
  localShotCount: number
): boolean {
  return shotChartHydrationDroppedRows > 0 && localShotCount === 0
}

/** Do not delete cloud rows when local shots exist but none can be mapped to remote player ids. */
export function shouldAvoidShotChartCloudDelete(
  localShotCount: number,
  mappableRowCount: number
): boolean {
  return localShotCount > 0 && mappableRowCount === 0
}
