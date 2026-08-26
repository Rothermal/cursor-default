import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearBasketballClockLineupCapabilityCache,
  ensureBasketballClockLineupCapabilities,
  loadBasketballClockLineupCapabilities,
  type BasketballClockLineupCapabilityClient,
} from './clockLineupCapabilities'

const valid = { clockAndLineupsVersion: 1 }

afterEach(clearBasketballClockLineupCapabilityCache)

describe('Basketball clock and lineup capabilities', () => {
  it('accepts only the exact fixed response and classifies version drift', async () => {
    await expect(loadBasketballClockLineupCapabilities(client(valid)))
      .resolves.toMatchObject({ status: 'ready' })
    await expect(loadBasketballClockLineupCapabilities(client({ ...valid, extra: true })))
      .resolves.toMatchObject({ status: 'invalid_response' })
    await expect(loadBasketballClockLineupCapabilities(client({ clockAndLineupsVersion: 0 })))
      .resolves.toMatchObject({ status: 'backend_update_required' })
    await expect(loadBasketballClockLineupCapabilities(client({ clockAndLineupsVersion: 2 })))
      .resolves.toMatchObject({ status: 'client_update_required' })
  })

  it('isolates successful caches by account and does not cache failures', async () => {
    const readyClient = client(valid)
    await ensureBasketballClockLineupCapabilities('user-a', { client: readyClient })
    await ensureBasketballClockLineupCapabilities('user-a', { client: readyClient })
    await ensureBasketballClockLineupCapabilities('user-b', { client: readyClient })
    expect(readyClient.rpc).toHaveBeenCalledTimes(2)

    const offlineClient = client(null, { message: 'Failed to fetch' })
    await ensureBasketballClockLineupCapabilities('user-c', { client: offlineClient })
    await ensureBasketballClockLineupCapabilities('user-c', { client: offlineClient })
    expect(offlineClient.rpc).toHaveBeenCalledTimes(2)
  })
})

function client(
  data: unknown,
  error: { code?: string; message?: string } | null = null
): BasketballClockLineupCapabilityClient {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}
