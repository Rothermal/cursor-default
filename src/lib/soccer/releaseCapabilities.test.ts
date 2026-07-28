import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSoccerReleaseCapabilityCache,
  ensureSoccerReleaseCapabilities,
  loadSoccerReleaseCapabilities,
  type SoccerReleaseCapabilityClient,
} from './releaseCapabilities'

const validCapabilities = {
  contractVersion: 1,
  migration: 49,
  eventTransportVersion: 4,
  recoveryVersion: 1,
  recorderResolutionVersion: 1,
  canonicalFinalizationVersion: 1,
  aggregateSourceVersion: 1,
  settingsSchemaVersion: 1,
}

function clientWith(
  data: unknown,
  error: { code?: string; message?: string } | null = null
): SoccerReleaseCapabilityClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  }
}

afterEach(() => {
  clearSoccerReleaseCapabilityCache()
})

describe('loadSoccerReleaseCapabilities', () => {
  it('accepts only the exact supported contract', async () => {
    await expect(
      loadSoccerReleaseCapabilities(clientWith(validCapabilities))
    ).resolves.toMatchObject({ status: 'ready' })
    await expect(
      loadSoccerReleaseCapabilities(clientWith({ ...validCapabilities, unexpected: true }))
    ).resolves.toMatchObject({ status: 'invalid_response' })
    await expect(
      loadSoccerReleaseCapabilities(clientWith({ ...validCapabilities, migration: 48 }))
    ).resolves.toMatchObject({ status: 'invalid_response' })
  })

  it('classifies older and newer contract versions before parsing their fields', async () => {
    await expect(
      loadSoccerReleaseCapabilities(clientWith({ contractVersion: 0 }))
    ).resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(
      loadSoccerReleaseCapabilities(clientWith({ contractVersion: 2 }))
    ).resolves.toMatchObject({ status: 'client_update_required' })
  })

  it('distinguishes missing backend, access, and offline failures', async () => {
    await expect(
      loadSoccerReleaseCapabilities(clientWith(null, {
        code: 'PGRST202',
        message: 'Could not find the function',
      }))
    ).resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(
      loadSoccerReleaseCapabilities(clientWith(null, {
        code: '42501',
        message: 'permission denied',
      }))
    ).resolves.toMatchObject({ status: 'access_denied' })
    await expect(
      loadSoccerReleaseCapabilities(clientWith(null, {
        message: 'TypeError: Failed to fetch',
      }))
    ).resolves.toMatchObject({ status: 'offline' })
  })
})

describe('ensureSoccerReleaseCapabilities', () => {
  it('shares a successful in-flight request and caches it for one account', async () => {
    const client = clientWith(validCapabilities)
    const first = ensureSoccerReleaseCapabilities('user-a', { client })
    const second = ensureSoccerReleaseCapabilities('user-a', { client })

    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ status: 'ready' })
    await ensureSoccerReleaseCapabilities('user-a', { client })
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('does not reuse capability success across accounts or explicit retry', async () => {
    const client = clientWith(validCapabilities)
    await ensureSoccerReleaseCapabilities('user-a', { client })
    await ensureSoccerReleaseCapabilities('user-b', { client })
    await ensureSoccerReleaseCapabilities('user-b', { client, force: true })

    expect(client.rpc).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failed preflight', async () => {
    const client = clientWith(null, { message: 'Failed to fetch' })
    await ensureSoccerReleaseCapabilities('user-a', { client })
    await ensureSoccerReleaseCapabilities('user-a', { client })

    expect(client.rpc).toHaveBeenCalledTimes(2)
  })
})
