import { captureAuthIdentity, isCurrentAuthIdentity, type AuthIdentitySnapshot } from '../authIdentity'
import { isPlainObject } from '../gameEvents/envelope'
import { supabase } from '../supabase'
import { BaseballFeatureError, exactKeys, invalid, type BaseballFeatureErrorCode } from './featureErrors'
export { BaseballFeatureError, exactKeys, invalid, requiredString, type BaseballFeatureErrorCode } from './featureErrors'

export interface BaseballRpcResponse {
  data: unknown
  error: { code?: string; message?: string; details?: string; hint?: string } | null
}
export interface BaseballRpcRequest extends PromiseLike<BaseballRpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<BaseballRpcResponse>
}
export interface BaseballRpcClient {
  rpc(name: string, parameters?: Record<string, unknown>): BaseballRpcRequest
}
export interface BaseballFeatureOptions {
  client?: BaseballRpcClient
  signal?: AbortSignal
}

export const BASEBALL_AGGREGATE_CAPABILITIES = Object.freeze({
  contractVersion: 1, sportId: 'baseball', aggregateContractVersion: 1, migration: 79,
})
export const BASEBALL_PERSONAL_LINK_CAPABILITIES = Object.freeze({
  contractVersion: 1, sportId: 'baseball', personalLinkContractVersion: 1,
  publicationIdentityVersion: 1, reviewedFinalizationVersion: 1, migration: 79,
})
export const BASEBALL_PERSONAL_SETTINGS_CAPABILITIES = Object.freeze({
  contractVersion: 1, sportId: 'baseball', personalSettingsVersion: 1, migration: 80,
})
export type BaseballFeature = 'aggregate' | 'personal_links' | 'personal_settings'

/** Exact independent feature contracts; never reuse the release checker's ready cache. */
export function parseBaseballFeatureCapabilities(value: unknown, feature: BaseballFeature): void {
  const expected = feature === 'aggregate' ? BASEBALL_AGGREGATE_CAPABILITIES
    : feature === 'personal_links' ? BASEBALL_PERSONAL_LINK_CAPABILITIES : BASEBALL_PERSONAL_SETTINGS_CAPABILITIES
  if (!isPlainObject(value)) throw invalid('Invalid Baseball feature capabilities.')
  const version = value.contractVersion
  if (!Number.isSafeInteger(version) || Number(version) < 0) throw invalid('Invalid Baseball capability version.')
  if (version === 0 && exactKeys(value, ['contractVersion'])) {
    throw new BaseballFeatureError('backend_update_required', 'This Baseball feature needs a backend update.')
  }
  if (version === 0) throw invalid('Invalid Baseball unavailable capability envelope.')
  if (Number(version) > 1) throw new BaseballFeatureError('client_update_required', 'Reload the app to use this Baseball feature.')
  if (!exactKeys(value, Object.keys(expected)) || value.sportId !== 'baseball') throw invalid('Invalid Baseball feature capabilities.')
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (typeof expectedValue !== 'number') continue
    const actual = value[key]
    if (!Number.isSafeInteger(actual) || Number(actual) < 0) throw invalid('Invalid Baseball capability value.')
  }
  if (Object.entries(expected).some(([key, expectedValue]) => typeof expectedValue === 'number' && Number(value[key]) > expectedValue)) {
    throw new BaseballFeatureError('client_update_required', 'Reload the app to use this Baseball feature.')
  }
  if (Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
    throw new BaseballFeatureError('backend_update_required', 'This Baseball feature needs a backend update.')
  }
}

export interface BaseballFeatureClient {
  readonly identity: AuthIdentitySnapshot
  assertCurrent(): void
  request(name: string, parameters?: Record<string, unknown>): Promise<unknown>
  require(feature: BaseballFeature): Promise<void>
}

export function createBaseballFeatureClient(userId: string, options: BaseballFeatureOptions = {}): BaseballFeatureClient {
  const identity = captureAuthIdentity(userId)
  if (!identity) throw new BaseballFeatureError('stale_account', 'The Baseball account is no longer current.')
  const client = options.client ?? (supabase as unknown as BaseballRpcClient | null)
  const assertCurrent = () => {
    if (!isCurrentAuthIdentity(identity)) throw new BaseballFeatureError('stale_account', 'The Baseball account changed. Retry this operation.')
    if (options.signal?.aborted) throw new BaseballFeatureError('aborted', 'The Baseball operation was cancelled.')
  }
  const request = async (name: string, parameters?: Record<string, unknown>): Promise<unknown> => {
    assertCurrent()
    if (!client) throw new BaseballFeatureError('not_configured', 'Supabase is not configured.')
    try {
      const pending = client.rpc(name, parameters)
      const response = await (options.signal && pending.abortSignal ? pending.abortSignal(options.signal) : pending)
      assertCurrent()
      if (response.error) throw rpcError(response.error)
      return response.data
    } catch (error) {
      assertCurrent()
      if (error instanceof BaseballFeatureError) throw error
      throw new BaseballFeatureError('transport', 'The Baseball request failed. Retry when online.', error)
    }
  }
  return {
    identity, assertCurrent, request,
    async require(feature) {
      const data = await request(feature === 'aggregate' ? 'get_baseball_aggregate_capabilities'
        : feature === 'personal_links' ? 'get_baseball_personal_link_capabilities' : 'get_baseball_personal_settings_capabilities')
      assertCurrent()
      parseBaseballFeatureCapabilities(data, feature)
    },
  }
}

function rpcError(error: NonNullable<BaseballRpcResponse['error']>): BaseballFeatureError {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
  const code: BaseballFeatureErrorCode = error.code === 'PGRST202' || error.code === '42883' || text.includes('schema cache')
    ? 'backend_update_required'
    : error.code === '42501' || error.code === 'PGRST301' || /permission|authorized|authentication|app_access_|jwt/.test(text)
      ? 'access_denied'
      : /changed|refresh|reused|already linked|replacing/.test(text) ? 'conflict' : 'transport'
  return new BaseballFeatureError(code, error.message ?? 'The Baseball request failed.', error)
}
