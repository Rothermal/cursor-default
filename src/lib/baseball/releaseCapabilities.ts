import {
  createReleaseCapabilityChecker,
  type ReleaseCapabilityClient,
  type ReleaseCapabilityResult,
} from '../eventReleaseCapabilities'

/** `get_baseball_release_capabilities`: contract 2 in migration 078 (actual first-upload revisions). */
export interface BaseballReleaseCapabilities {
  contractVersion: 2
  migration: 78
  eventTransportVersion: 4
  recoveryVersion: 1
  recorderResolutionVersion: 1
  canonicalFinalizationVersion: 1
  setupSnapshotVersion: 1
}

export type BaseballReleaseCapabilityResult = ReleaseCapabilityResult<BaseballReleaseCapabilities>

const checker = createReleaseCapabilityChecker<BaseballReleaseCapabilities>({
  rpcName: 'get_baseball_release_capabilities',
  subject: 'Baseball cloud games',
  expected: {
    contractVersion: 2,
    migration: 78,
    eventTransportVersion: 4,
    recoveryVersion: 1,
    recorderResolutionVersion: 1,
    canonicalFinalizationVersion: 1,
    setupSnapshotVersion: 1,
  },
})

export function loadBaseballReleaseCapabilities(
  client?: ReleaseCapabilityClient | null
): Promise<BaseballReleaseCapabilityResult> {
  return checker.load(client)
}

export function ensureBaseballReleaseCapabilities(
  userId: string,
  options?: { client?: ReleaseCapabilityClient | null; force?: boolean }
): Promise<BaseballReleaseCapabilityResult> {
  return checker.ensure(userId, options)
}

export function clearBaseballReleaseCapabilityCache(): void {
  checker.clear()
}
