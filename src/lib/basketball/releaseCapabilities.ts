import { supabase } from '../supabase'

export const BASKETBALL_RELEASE_CONTRACT_VERSION = 2

export interface BasketballReleaseCapabilities {
  contractVersion: 2
  migration: 62
  eventTransportVersion: 4
  recoveryVersion: 1
  recorderResolutionVersion: 1
  canonicalFinalizationVersion: 1
  summaryAuthorityVersion: 1
  aggregateSourceVersion: 1
  settingsContractVersion: 1
}

export type BasketballReleaseCapabilityResult =
  | { status: 'ready'; capabilities: BasketballReleaseCapabilities }
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

export interface BasketballReleaseCapabilityClient {
  rpc: (
    functionName: string
  ) => PromiseLike<{ data: unknown; error: CapabilityRpcError | null }>
}

interface BasketballEventCloudPreflightInput {
  eventIntent: boolean
  cloudIntent: 'automatic' | 'local_only' | null
}

export function requiresBasketballEventCloudPreflight({
  eventIntent,
  cloudIntent,
}: BasketballEventCloudPreflightInput): boolean {
  return eventIntent && cloudIntent === 'automatic'
}

const expectedCapabilities: BasketballReleaseCapabilities = {
  contractVersion: 2,
  migration: 62,
  eventTransportVersion: 4,
  recoveryVersion: 1,
  recorderResolutionVersion: 1,
  canonicalFinalizationVersion: 1,
  summaryAuthorityVersion: 1,
  aggregateSourceVersion: 1,
  settingsContractVersion: 1,
}

let activeUserId: string | null = null
let cachedReady: BasketballReleaseCapabilityResult | null = null
let inFlight: Promise<BasketballReleaseCapabilityResult> | null = null
let requestGeneration = 0

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function combinedErrorText(error: CapabilityRpcError): string {
  return [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isMissingCapabilityRpc(error: CapabilityRpcError): boolean {
  const message = combinedErrorText(error)
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    message.includes('schema cache') ||
    message.includes('could not find the function') ||
    (
      message.includes('get_basketball_release_capabilities') &&
      message.includes('does not exist')
    )
  )
}

function isAuthenticationError(error: CapabilityRpcError): boolean {
  const message = combinedErrorText(error)
  return (
    error.code === 'PGRST301' ||
    message.includes('authentication required') ||
    message.includes('jwt')
  )
}

function isAccessError(error: CapabilityRpcError): boolean {
  const message = combinedErrorText(error)
  return (
    error.code === '42501' ||
    message.includes('app_access_') ||
    message.includes('permission denied') ||
    message.includes('not authorized')
  )
}

function isNetworkError(error: CapabilityRpcError): boolean {
  if (error.code) return false
  const message = combinedErrorText(error)
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    message.includes('offline')
  )
}

function parseCapabilities(value: unknown): BasketballReleaseCapabilityResult {
  if (!isPlainObject(value)) {
    return {
      status: 'invalid_response',
      error: 'The Basketball cloud capability response was invalid.',
    }
  }

  const version = value.contractVersion
  if (!Number.isInteger(version) || Number(version) < 0) {
    return {
      status: 'invalid_response',
      error: 'The Basketball cloud capability response was invalid.',
    }
  }
  if (Number(version) < BASKETBALL_RELEASE_CONTRACT_VERSION) {
    return {
      status: 'backend_update_required',
      error: 'Basketball event cloud games require the latest backend update.',
    }
  }
  if (Number(version) > BASKETBALL_RELEASE_CONTRACT_VERSION) {
    return {
      status: 'client_update_required',
      error: 'This app is out of date. Reload it before starting a Basketball event cloud game. If this message returns in the installed app, close and reopen the app once more.',
    }
  }

  const expectedKeys = Object.keys(expectedCapabilities).sort()
  const actualKeys = Object.keys(value).sort()
  const exactShape =
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index]) &&
    expectedKeys.every(key =>
      value[key] === expectedCapabilities[key as keyof BasketballReleaseCapabilities]
    )

  if (!exactShape) {
    return {
      status: 'invalid_response',
      error: 'The Basketball cloud capability response was invalid.',
    }
  }

  return {
    status: 'ready',
    capabilities: value as unknown as BasketballReleaseCapabilities,
  }
}

export async function loadBasketballReleaseCapabilities(
  client: BasketballReleaseCapabilityClient | null =
    supabase as unknown as BasketballReleaseCapabilityClient | null
): Promise<BasketballReleaseCapabilityResult> {
  if (!client) {
    return {
      status: 'not_configured',
      error: 'Basketball event cloud games require Supabase configuration.',
    }
  }

  try {
    const { data, error } = await client.rpc('get_basketball_release_capabilities')
    if (error) {
      if (isMissingCapabilityRpc(error)) {
        return {
          status: 'backend_update_required',
          error: 'Basketball event cloud games require the latest backend update.',
        }
      }
      if (isAuthenticationError(error)) {
        return {
          status: 'authentication_required',
          error: 'Sign in again before starting a Basketball event cloud game.',
        }
      }
      if (isAccessError(error)) {
        return {
          status: 'access_denied',
          error: 'Your account cannot start this Basketball event cloud game.',
        }
      }
      if (isNetworkError(error)) {
        return {
          status: 'offline',
          error: 'Basketball event cloud support could not be checked while offline.',
        }
      }
      return {
        status: 'error',
        error: 'Basketball event cloud support could not be checked.',
      }
    }
    return parseCapabilities(data)
  } catch (error) {
    const rpcError: CapabilityRpcError = {
      message: error instanceof Error ? error.message : String(error),
    }
    return isNetworkError(rpcError)
      ? {
          status: 'offline',
          error: 'Basketball event cloud support could not be checked while offline.',
        }
      : {
          status: 'error',
          error: 'Basketball event cloud support could not be checked.',
        }
  }
}

export function clearBasketballReleaseCapabilityCache(): void {
  requestGeneration += 1
  activeUserId = null
  cachedReady = null
  inFlight = null
}

export function ensureBasketballReleaseCapabilities(
  userId: string,
  options: {
    client?: BasketballReleaseCapabilityClient | null
    force?: boolean
  } = {}
): Promise<BasketballReleaseCapabilityResult> {
  if (activeUserId !== userId) {
    requestGeneration += 1
    activeUserId = userId
    cachedReady = null
    inFlight = null
  }
  if (options.force) {
    requestGeneration += 1
    cachedReady = null
    inFlight = null
  }
  if (cachedReady?.status === 'ready') return Promise.resolve(cachedReady)
  if (inFlight) return inFlight

  const requestUserId = userId
  const generation = requestGeneration
  const request = loadBasketballReleaseCapabilities(
    options.client === undefined
      ? supabase as unknown as BasketballReleaseCapabilityClient | null
      : options.client
  ).then(result => {
    if (
      activeUserId === requestUserId &&
      requestGeneration === generation &&
      result.status === 'ready'
    ) {
      cachedReady = result
    }
    if (
      activeUserId === requestUserId &&
      requestGeneration === generation &&
      inFlight === request
    ) {
      inFlight = null
    }
    return result
  })
  inFlight = request
  return request
}
