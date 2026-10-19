import type { EventCloudPolicy } from '../eventCloudPolicy'
import type { BaseballReleaseCapabilityResult } from './releaseCapabilities'

export type BaseballSetupStorage = 'cloud' | 'device'

export type BaseballSetupCapabilityState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: BaseballReleaseCapabilityResult }

export type BaseballSetupCloudGate =
  | { canStart: true; cloudPolicy: EventCloudPolicy }
  | { canStart: false; checking: boolean; message: string | null }

/**
 * BSB-6B setup choice. Signed out, a game is saved on this device. Signed in, Cloud needs a
 * ready release handshake (migrations 076-077 applied); a failed check offers Retry or This
 * device only, and never silently falls back.
 */
export function baseballSetupCloudGate(input: {
  cloudAvailable: boolean
  storage: BaseballSetupStorage
  capability: BaseballSetupCapabilityState
}): BaseballSetupCloudGate {
  if (!input.cloudAvailable || input.storage === 'device') return { canStart: true, cloudPolicy: 'local_only' }
  const { capability } = input
  if (capability.status !== 'done') return { canStart: false, checking: true, message: null }
  if (capability.result.status === 'ready') return { canStart: true, cloudPolicy: 'automatic' }
  return { canStart: false, checking: false, message: capability.result.error }
}
