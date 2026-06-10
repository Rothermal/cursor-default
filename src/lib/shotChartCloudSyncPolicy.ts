/**
 * Shot-chart cloud sync is blocked while hydration left unmapped cloud rows and the
 * local chart may still be incomplete. After an explicit full clear, the guard resets.
 */
export function shouldSkipShotChartCloudSync(shotChartHydrationDroppedRows: number): boolean {
  return shotChartHydrationDroppedRows > 0
}
