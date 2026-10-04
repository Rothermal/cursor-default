import type { EventCloudPolicy } from '../eventCloudPolicy'
import type { HockeyReleaseCapabilityResult } from './releaseCapabilities'

export type HockeySetupStorage = 'cloud' | 'device'

export type HockeySetupCapabilityState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: HockeyReleaseCapabilityResult }

export type HockeySetupCloudGate =
  | { canStart: true; cloudPolicy: EventCloudPolicy }
  | { canStart: false; checking: boolean; message: string | null }

/**
 * HKY-5B setup choice. Signed out, a game is saved on this device. Signed in, Cloud needs a
 * ready release handshake (migrations 072-073 applied); a failed check offers Retry or This
 * device only, and never silently falls back.
 */
export function hockeySetupCloudGate(input: {
  cloudAvailable: boolean
  storage: HockeySetupStorage
  capability: HockeySetupCapabilityState
}): HockeySetupCloudGate {
  if (!input.cloudAvailable || input.storage === 'device') return { canStart: true, cloudPolicy: 'local_only' }
  const { capability } = input
  if (capability.status !== 'done') return { canStart: false, checking: true, message: null }
  if (capability.result.status === 'ready') return { canStart: true, cloudPolicy: 'automatic' }
  return { canStart: false, checking: false, message: capability.result.error }
}
