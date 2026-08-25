import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearBasketballReleaseCapabilityCache,
  ensureBasketballReleaseCapabilities,
  loadBasketballReleaseCapabilities,
  requiresBasketballEventCloudPreflight,
  type BasketballReleaseCapabilityClient,
} from './releaseCapabilities'

const validCapabilities = {
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

function clientWith(
  data: unknown,
  error: { code?: string; message?: string } | null = null
): BasketballReleaseCapabilityClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  }
}

afterEach(() => {
  clearBasketballReleaseCapabilityCache()
})

describe('loadBasketballReleaseCapabilities', () => {
  it('accepts only the exact supported contract', async () => {
    await expect(
      loadBasketballReleaseCapabilities(clientWith(validCapabilities))
    ).resolves.toMatchObject({ status: 'ready' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith({
        ...validCapabilities,
        unexpected: true,
      }))
    ).resolves.toMatchObject({ status: 'invalid_response' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith({
        ...validCapabilities,
        migration: 60,
      }))
    ).resolves.toMatchObject({ status: 'invalid_response' })
  })

  it('classifies older and newer contract versions before parsing fields', async () => {
    await expect(
      loadBasketballReleaseCapabilities(clientWith({ contractVersion: 0 }))
    ).resolves.toMatchObject({ status: 'backend_update_required' })
    const staleClient = await loadBasketballReleaseCapabilities(
      clientWith({ contractVersion: 3 })
    )
    expect(staleClient).toMatchObject({ status: 'client_update_required' })
    if (staleClient.status === 'ready') {
      throw new Error('expected a stale-client capability result')
    }
    expect(staleClient.error).toContain('close and reopen')
  })

  it('distinguishes backend, authentication, access, offline, and coded failures', async () => {
    await expect(
      loadBasketballReleaseCapabilities(clientWith(null, {
        code: 'PGRST301',
        message: 'JWT expired',
      }))
    ).resolves.toMatchObject({ status: 'authentication_required' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith(null, {
        code: 'PGRST202',
        message: 'Could not find the function',
      }))
    ).resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith(null, {
        code: '42501',
        message: 'permission denied',
      }))
    ).resolves.toMatchObject({ status: 'access_denied' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith(null, {
        message: 'TypeError: Failed to fetch',
      }))
    ).resolves.toMatchObject({ status: 'offline' })
    await expect(
      loadBasketballReleaseCapabilities(clientWith(null, {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      }))
    ).resolves.toMatchObject({ status: 'error' })
  })

  it('classifies thrown network failures and missing configuration', async () => {
    const throwingClient: BasketballReleaseCapabilityClient = {
      rpc: vi.fn().mockRejectedValue(new Error('NetworkError when attempting to fetch')),
    }
    await expect(
      loadBasketballReleaseCapabilities(throwingClient)
    ).resolves.toMatchObject({ status: 'offline' })
    await expect(
      loadBasketballReleaseCapabilities(null)
    ).resolves.toMatchObject({ status: 'not_configured' })
  })
})

describe('requiresBasketballEventCloudPreflight', () => {
  it('gates only automatic Event cloud creation', () => {
    expect(requiresBasketballEventCloudPreflight({
      eventIntent: true,
      cloudIntent: 'automatic',
    })).toBe(true)

    for (const input of [
      {
        eventIntent: false,
        cloudIntent: 'automatic' as const,
      },
      {
        eventIntent: true,
        cloudIntent: 'local_only' as const,
      },
      {
        eventIntent: true,
        cloudIntent: null,
      },
    ]) {
      expect(requiresBasketballEventCloudPreflight(input)).toBe(false)
    }
  })
})

describe('ensureBasketballReleaseCapabilities', () => {
  it('shares and caches a successful request for one account', async () => {
    const client = clientWith(validCapabilities)
    const first = ensureBasketballReleaseCapabilities('user-a', { client })
    const second = ensureBasketballReleaseCapabilities('user-a', { client })

    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ status: 'ready' })
    await ensureBasketballReleaseCapabilities('user-a', { client })
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('isolates accounts and supports explicit retry', async () => {
    const client = clientWith(validCapabilities)
    await ensureBasketballReleaseCapabilities('user-a', { client })
    await ensureBasketballReleaseCapabilities('user-b', { client })
    await ensureBasketballReleaseCapabilities('user-b', { client, force: true })

    expect(client.rpc).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failed preflight', async () => {
    const client = clientWith(null, { message: 'Failed to fetch' })
    await ensureBasketballReleaseCapabilities('user-a', { client })
    await ensureBasketballReleaseCapabilities('user-a', { client })

    expect(client.rpc).toHaveBeenCalledTimes(2)
  })

  it('does not cache a superseded in-flight success after a forced retry', async () => {
    let resolveFirst!: (value: { data: unknown; error: null }) => void
    const firstResponse = new Promise<{ data: unknown; error: null }>(resolve => {
      resolveFirst = resolve
    })
    const client: BasketballReleaseCapabilityClient = {
      rpc: vi.fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce({ data: { contractVersion: 0 }, error: null })
        .mockResolvedValueOnce({ data: validCapabilities, error: null }),
    }

    const first = ensureBasketballReleaseCapabilities('user-a', { client })
    await expect(
      ensureBasketballReleaseCapabilities('user-a', { client, force: true })
    ).resolves.toMatchObject({ status: 'backend_update_required' })
    resolveFirst({ data: validCapabilities, error: null })
    await expect(first).resolves.toMatchObject({ status: 'ready' })
    await expect(
      ensureBasketballReleaseCapabilities('user-a', { client })
    ).resolves.toMatchObject({ status: 'ready' })

    expect(client.rpc).toHaveBeenCalledTimes(3)
  })
})
