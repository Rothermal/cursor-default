import { supabase } from './supabase'

/**
 * Exact-version cloud contract handshake for an event sport (the BKE-4E5 pattern, sport
 * neutral since HKY-5B). The server returns `{ contractVersion: 0 }` until every table and
 * fixed RPC is present, so the client stays local-only until the owner applies the migration.
 */
export type ReleaseCapabilityStatus =
  | 'backend_update_required'
  | 'client_update_required'
  | 'offline'
  | 'authentication_required'
  | 'access_denied'
  | 'invalid_response'
  | 'error'
  | 'not_configured'

export type ReleaseCapabilityResult<T> =
  | { status: 'ready'; capabilities: T }
  | { status: ReleaseCapabilityStatus; error: string }

interface CapabilityRpcError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export interface ReleaseCapabilityClient {
  rpc: (functionName: string) => PromiseLike<{ data: unknown; error: CapabilityRpcError | null }>
}

export interface ReleaseCapabilityChecker<T> {
  load(client?: ReleaseCapabilityClient | null): Promise<ReleaseCapabilityResult<T>>
  ensure(
    userId: string,
    options?: { client?: ReleaseCapabilityClient | null; force?: boolean }
  ): Promise<ReleaseCapabilityResult<T>>
  clear(): void
}

export function createReleaseCapabilityChecker<T extends { contractVersion: number }>(config: {
  rpcName: string
  /** Lower-case wording, e.g. "Hockey cloud games". */
  subject: string
  expected: T
}): ReleaseCapabilityChecker<T> {
  const { rpcName, subject, expected } = config
  const Subject = subject.charAt(0).toUpperCase() + subject.slice(1)
  const backendUpdate = `${Subject} require the latest backend update.`
  const invalid = `The ${subject} capability response was invalid.`

  let activeUserId: string | null = null
  let cachedReady: ReleaseCapabilityResult<T> | null = null
  let inFlight: Promise<ReleaseCapabilityResult<T>> | null = null
  let requestGeneration = 0

  function errorText(error: CapabilityRpcError): string {
    return [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
  }

  function isMissingRpc(error: CapabilityRpcError): boolean {
    const message = errorText(error)
    return (
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      message.includes('schema cache') ||
      message.includes('could not find the function') ||
      (message.includes(rpcName) && message.includes('does not exist'))
    )
  }

  function isAuthentication(error: CapabilityRpcError): boolean {
    const message = errorText(error)
    return error.code === 'PGRST301' || message.includes('authentication required') || message.includes('jwt')
  }

  function isAccess(error: CapabilityRpcError): boolean {
    const message = errorText(error)
    return (
      error.code === '42501' ||
      message.includes('app_access_') ||
      message.includes('permission denied') ||
      message.includes('not authorized')
    )
  }

  function isNetwork(error: CapabilityRpcError): boolean {
    if (error.code) return false
    const message = errorText(error)
    return (
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network error') ||
      message.includes('load failed') ||
      message.includes('offline')
    )
  }

  function parse(value: unknown): ReleaseCapabilityResult<T> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { status: 'invalid_response', error: invalid }
    }
    const record = value as Record<string, unknown>
    const version = record.contractVersion
    if (!Number.isInteger(version) || Number(version) < 0) {
      return { status: 'invalid_response', error: invalid }
    }
    if (Number(version) < expected.contractVersion) {
      return { status: 'backend_update_required', error: backendUpdate }
    }
    if (Number(version) > expected.contractVersion) {
      return {
        status: 'client_update_required',
        error: `This app is out of date. Reload it before using ${subject}. If this message returns in the installed app, close and reopen the app once more.`,
      }
    }
    const expectedKeys = Object.keys(expected).sort()
    const actualKeys = Object.keys(record).sort()
    const exact =
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every((key, index) => key === actualKeys[index]) &&
      expectedKeys.every(key => record[key] === expected[key as keyof T])
    return exact
      ? { status: 'ready', capabilities: { ...expected } }
      : { status: 'invalid_response', error: invalid }
  }

  async function load(
    client: ReleaseCapabilityClient | null = supabase as unknown as ReleaseCapabilityClient | null
  ): Promise<ReleaseCapabilityResult<T>> {
    if (!client) return { status: 'not_configured', error: `${Subject} require Supabase configuration.` }
    try {
      const { data, error } = await client.rpc(rpcName)
      if (error) {
        if (isMissingRpc(error)) return { status: 'backend_update_required', error: backendUpdate }
        if (isAuthentication(error)) {
          return { status: 'authentication_required', error: `Sign in again before using ${subject}.` }
        }
        if (isAccess(error)) return { status: 'access_denied', error: `Your account cannot use ${subject}.` }
        if (isNetwork(error)) {
          return { status: 'offline', error: `Support for ${subject} could not be checked while offline.` }
        }
        return { status: 'error', error: `Support for ${subject} could not be checked.` }
      }
      return parse(data)
    } catch (caught) {
      const rpcError: CapabilityRpcError = { message: caught instanceof Error ? caught.message : String(caught) }
      return isNetwork(rpcError)
        ? { status: 'offline', error: `Support for ${subject} could not be checked while offline.` }
        : { status: 'error', error: `Support for ${subject} could not be checked.` }
    }
  }

  function clear(): void {
    requestGeneration += 1
    activeUserId = null
    cachedReady = null
    inFlight = null
  }

  function ensure(
    userId: string,
    options: { client?: ReleaseCapabilityClient | null; force?: boolean } = {}
  ): Promise<ReleaseCapabilityResult<T>> {
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

    const generation = requestGeneration
    const request = load(
      options.client === undefined
        ? supabase as unknown as ReleaseCapabilityClient | null
        : options.client
    ).then(result => {
      const current = activeUserId === userId && requestGeneration === generation
      if (current && result.status === 'ready') cachedReady = result
      if (current && inFlight === request) inFlight = null
      return result
    })
    inFlight = request
    return request
  }

  return { load, ensure, clear }
}
