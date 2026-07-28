import { supabase } from '../supabase'

export const SOCCER_RELEASE_CONTRACT_VERSION = 1

export interface SoccerReleaseCapabilities {
  contractVersion: 1
  migration: 49
  eventTransportVersion: 4
  recoveryVersion: 1
  recorderResolutionVersion: 1
  canonicalFinalizationVersion: 1
  aggregateSourceVersion: 1
  settingsSchemaVersion: 1
}

export type SoccerReleaseCapabilityResult =
  | { status: 'ready'; capabilities: SoccerReleaseCapabilities }
  | {
      status:
        | 'backend_update_required'
        | 'client_update_required'
        | 'offline'
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

export interface SoccerReleaseCapabilityClient {
  rpc: (
    functionName: string
  ) => PromiseLike<{ data: unknown; error: CapabilityRpcError | null }>
}

const expectedCapabilities: SoccerReleaseCapabilities = {
  contractVersion: 1,
  migration: 49,
  eventTransportVersion: 4,
  recoveryVersion: 1,
  recorderResolutionVersion: 1,
  canonicalFinalizationVersion: 1,
  aggregateSourceVersion: 1,
  settingsSchemaVersion: 1,
}

let activeUserId: string | null = null
let cachedReady: SoccerReleaseCapabilityResult | null = null
let inFlight: Promise<SoccerReleaseCapabilityResult> | null = null

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
      message.includes('get_soccer_release_capabilities') &&
      message.includes('does not exist')
    )
  )
}

function isAccessError(error: CapabilityRpcError): boolean {
  const message = combinedErrorText(error)
  return (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    message.includes('app_access_') ||
    message.includes('permission denied') ||
    message.includes('not authorized') ||
    message.includes('authentication required') ||
    message.includes('jwt')
  )
}

function isNetworkError(error: CapabilityRpcError): boolean {
  const message = combinedErrorText(error)
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    message.includes('offline') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

function parseCapabilities(value: unknown): SoccerReleaseCapabilityResult {
  if (!isPlainObject(value)) {
    return {
      status: 'invalid_response',
      error: 'The Soccer cloud capability response was invalid.',
    }
  }

  const version = value.contractVersion
  if (!Number.isInteger(version) || Number(version) < 0) {
    return {
      status: 'invalid_response',
      error: 'The Soccer cloud capability response was invalid.',
    }
  }
  if (Number(version) < SOCCER_RELEASE_CONTRACT_VERSION) {
    return {
      status: 'backend_update_required',
      error: 'Soccer cloud games require the latest backend update.',
    }
  }
  if (Number(version) > SOCCER_RELEASE_CONTRACT_VERSION) {
    return {
      status: 'client_update_required',
      error: 'This app is out of date. Reload or update the app before starting a cloud Soccer match.',
    }
  }

  const expectedKeys = Object.keys(expectedCapabilities).sort()
  const actualKeys = Object.keys(value).sort()
  const exactShape =
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index]) &&
    expectedKeys.every(key => value[key] === expectedCapabilities[key as keyof SoccerReleaseCapabilities])

  if (!exactShape) {
    return {
      status: 'invalid_response',
      error: 'The Soccer cloud capability response was invalid.',
    }
  }

  return {
    status: 'ready',
    capabilities: value as unknown as SoccerReleaseCapabilities,
  }
}

export async function loadSoccerReleaseCapabilities(
  client: SoccerReleaseCapabilityClient | null =
    supabase as unknown as SoccerReleaseCapabilityClient | null
): Promise<SoccerReleaseCapabilityResult> {
  if (!client) {
    return {
      status: 'not_configured',
      error: 'Cloud Soccer requires Supabase configuration.',
    }
  }

  try {
    const { data, error } = await client.rpc('get_soccer_release_capabilities')
    if (error) {
      if (isMissingCapabilityRpc(error)) {
        return {
          status: 'backend_update_required',
          error: 'Soccer cloud games require the latest backend update.',
        }
      }
      if (isAccessError(error)) {
        return {
          status: 'access_denied',
          error: 'Your account cannot start this cloud Soccer match.',
        }
      }
      if (isNetworkError(error)) {
        return {
          status: 'offline',
          error: 'Soccer cloud support could not be checked while offline.',
        }
      }
      return {
        status: 'error',
        error: 'Soccer cloud support could not be checked.',
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
          error: 'Soccer cloud support could not be checked while offline.',
        }
      : {
          status: 'error',
          error: 'Soccer cloud support could not be checked.',
        }
  }
}

export function clearSoccerReleaseCapabilityCache(): void {
  activeUserId = null
  cachedReady = null
  inFlight = null
}

export function ensureSoccerReleaseCapabilities(
  userId: string,
  options: {
    client?: SoccerReleaseCapabilityClient | null
    force?: boolean
  } = {}
): Promise<SoccerReleaseCapabilityResult> {
  if (activeUserId !== userId) {
    activeUserId = userId
    cachedReady = null
    inFlight = null
  }
  if (options.force) {
    cachedReady = null
    inFlight = null
  }
  if (cachedReady?.status === 'ready') return Promise.resolve(cachedReady)
  if (inFlight) return inFlight

  const requestUserId = userId
  const request = loadSoccerReleaseCapabilities(
    options.client === undefined
      ? supabase as unknown as SoccerReleaseCapabilityClient | null
      : options.client
  ).then(result => {
    if (activeUserId === requestUserId && result.status === 'ready') {
      cachedReady = result
    }
    if (activeUserId === requestUserId && inFlight === request) {
      inFlight = null
    }
    return result
  })
  inFlight = request
  return request
}
