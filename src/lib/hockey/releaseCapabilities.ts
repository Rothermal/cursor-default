import {
  createReleaseCapabilityChecker,
  type ReleaseCapabilityClient,
  type ReleaseCapabilityResult,
} from '../eventReleaseCapabilities'

/** `get_hockey_release_capabilities`: contract 1 in migration 073, contract 2 (settings) in 074. */
export interface HockeyReleaseCapabilities {
  contractVersion: 2
  migration: 74
  eventTransportVersion: 4
  recoveryVersion: 1
  recorderResolutionVersion: 1
  canonicalFinalizationVersion: 1
  setupSnapshotVersion: 1
  settingsContractVersion: 1
}

export type HockeyReleaseCapabilityResult = ReleaseCapabilityResult<HockeyReleaseCapabilities>

const checker = createReleaseCapabilityChecker<HockeyReleaseCapabilities>({
  rpcName: 'get_hockey_release_capabilities',
  subject: 'Hockey cloud games',
  expected: {
    contractVersion: 2,
    migration: 74,
    eventTransportVersion: 4,
    recoveryVersion: 1,
    recorderResolutionVersion: 1,
    canonicalFinalizationVersion: 1,
    setupSnapshotVersion: 1,
    settingsContractVersion: 1,
  },
})

export function loadHockeyReleaseCapabilities(
  client?: ReleaseCapabilityClient | null
): Promise<HockeyReleaseCapabilityResult> {
  return checker.load(client)
}

export function ensureHockeyReleaseCapabilities(
  userId: string,
  options?: { client?: ReleaseCapabilityClient | null; force?: boolean }
): Promise<HockeyReleaseCapabilityResult> {
  return checker.ensure(userId, options)
}

export function clearHockeyReleaseCapabilityCache(): void {
  checker.clear()
}
