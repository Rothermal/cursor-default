const LEGACY_AGGREGATE_CLOUD_SPORT_IDS = new Set([
  'basketball',
  'baseball',
  'football',
  'hockey',
])

export function sportSupportsLegacyAggregateCloudSync(sportId: string): boolean {
  return LEGACY_AGGREGATE_CLOUD_SPORT_IDS.has(sportId)
}
