import { supabase } from '../supabase'

export const BASKETBALL_CLOCK_LINEUP_CAPABILITY_VERSION = 1

export interface BasketballClockLineupCapabilities {
  clockAndLineupsVersion: 1
}

export type BasketballClockLineupCapabilityResult =
  | { status: 'ready'; capabilities: BasketballClockLineupCapabilities }
  | {
      status:
        | 'backend_update_required'
        | 'client_update_required'
        | 'offline'
        | 'authentication_required'
        | 'access_denied'
        | 'invalid_response'
        | 'error'
        | 'not_configured'
      error: string
    }

interface CapabilityRpcError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export interface BasketballClockLineupCapabilityClient {
  rpc: (
    functionName: string
  ) => PromiseLike<{ data: unknown; error: CapabilityRpcError | null }>
}

let activeUserId: string | null = null
let cachedReady: BasketballClockLineupCapabilityResult | null = null
let inFlight: Promise<BasketballClockLineupCapabilityResult> | null = null
let requestGeneration = 0

export async function loadBasketballClockLineupCapabilities(
  client: BasketballClockLineupCapabilityClient | null =
    supabase as unknown as BasketballClockLineupCapabilityClient | null
): Promise<BasketballClockLineupCapabilityResult> {
  if (!client) {
    return failure('not_configured', 'Basketball clock cloud support requires Supabase configuration.')
  }
  try {
    const { data, error } = await client.rpc('get_basketball_clock_lineup_capabilities_v1')
    if (error) return classifyRpcError(error)
    return parseCapabilities(data)
  } catch (error) {
    const rpcError = { message: error instanceof Error ? error.message : String(error) }
    return isNetworkError(rpcError)
      ? failure('offline', 'Basketball clock cloud support could not be checked while offline.')
      : failure('error', 'Basketball clock cloud support could not be checked.')
  }
}

export function ensureBasketballClockLineupCapabilities(
  userId: string,
  options: {
    client?: BasketballClockLineupCapabilityClient | null
    force?: boolean
  } = {}
): Promise<BasketballClockLineupCapabilityResult> {
  if (activeUserId !== userId || options.force) {
    requestGeneration += 1
    activeUserId = userId
    cachedReady = null
    inFlight = null
  }
  if (cachedReady?.status === 'ready') return Promise.resolve(cachedReady)
  if (inFlight) return inFlight

  const requestUserId = userId
  const generation = requestGeneration
  const request = loadBasketballClockLineupCapabilities(
    options.client === undefined
      ? supabase as unknown as BasketballClockLineupCapabilityClient | null
      : options.client
  ).then(result => {
    if (activeUserId === requestUserId && requestGeneration === generation) {
      if (result.status === 'ready') cachedReady = result
      if (inFlight === request) inFlight = null
    }
    return result
  })
  inFlight = request
  return request
}

export function clearBasketballClockLineupCapabilityCache(): void {
  requestGeneration += 1
  activeUserId = null
  cachedReady = null
  inFlight = null
}

function parseCapabilities(value: unknown): BasketballClockLineupCapabilityResult {
  if (!isPlainObject(value)) return invalidResponse()
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'clockAndLineupsVersion') return invalidResponse()
  const version = value.clockAndLineupsVersion
  if (!Number.isInteger(version) || Number(version) < 0) return invalidResponse()
  if (Number(version) < BASKETBALL_CLOCK_LINEUP_CAPABILITY_VERSION) {
    return failure('backend_update_required', 'Basketball clocks require the latest backend update.')
  }
  if (Number(version) > BASKETBALL_CLOCK_LINEUP_CAPABILITY_VERSION) {
    return failure('client_update_required', 'This app is out of date. Reload it before syncing a Basketball clock game.')
  }
  return {
    status: 'ready',
    capabilities: value as unknown as BasketballClockLineupCapabilities,
  }
}

function classifyRpcError(error: CapabilityRpcError): BasketballClockLineupCapabilityResult {
  const text = combinedErrorText(error)
  if (error.code === '42883' || error.code === 'PGRST202' ||
      text.includes('schema cache') || text.includes('could not find the function')) {
    return failure('backend_update_required', 'Basketball clocks require the latest backend update.')
  }
  if (error.code === 'PGRST301' || text.includes('authentication required') || text.includes('jwt')) {
    return failure('authentication_required', 'Sign in again before syncing a Basketball clock game.')
  }
  if (error.code === '42501' || text.includes('app_access_') ||
      text.includes('permission denied') || text.includes('not authorized')) {
    return failure('access_denied', 'Your account cannot sync this Basketball clock game.')
  }
  return isNetworkError(error)
    ? failure('offline', 'Basketball clock cloud support could not be checked while offline.')
    : failure('error', 'Basketball clock cloud support could not be checked.')
}

function isNetworkError(error: CapabilityRpcError): boolean {
  if (error.code) return false
  const text = combinedErrorText(error)
  return text.includes('failed to fetch') || text.includes('networkerror') ||
    text.includes('network error') || text.includes('load failed') || text.includes('offline')
}

function combinedErrorText(error: CapabilityRpcError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): BasketballClockLineupCapabilityResult {
  return failure('invalid_response', 'The Basketball clock capability response was invalid.')
}

function failure(
  status: Exclude<BasketballClockLineupCapabilityResult['status'], 'ready'>,
  error: string
): BasketballClockLineupCapabilityResult {
  return { status, error }
}
