import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  rpcData: null as unknown,
  rpcError: null as { code?: string; message?: string } | null,
  configured: true,
}))

vi.mock('./supabase', () => ({
  get supabase() {
    if (!mock.configured) return null
    return {
      rpc: (name: string) => {
        if (name !== 'get_my_app_access') {
          throw new Error(`unexpected rpc ${name}`)
        }
        return Promise.resolve({ data: mock.rpcData, error: mock.rpcError })
      },
    }
  },
}))

import { loadCurrentAppAccess, migrationFallbackAccess } from './appAccess'

describe('loadCurrentAppAccess', () => {
  beforeEach(() => {
    mock.rpcData = null
    mock.rpcError = null
    mock.configured = true
  })

  it('falls back to active/user when Supabase is not configured', async () => {
    mock.configured = false
    await expect(loadCurrentAppAccess()).resolves.toEqual({
      access: migrationFallbackAccess,
      error: null,
    })
  })

  it('falls back when the access RPC has not been migrated yet', async () => {
    mock.rpcError = { code: 'PGRST202', message: 'Could not find the function' }
    await expect(loadCurrentAppAccess()).resolves.toEqual({
      access: migrationFallbackAccess,
      error: null,
    })
  })

  it('returns RPC errors that are not missing-function fallbacks', async () => {
    mock.rpcError = { code: '42501', message: 'permission denied for function get_my_app_access' }
    await expect(loadCurrentAppAccess()).resolves.toEqual({
      access: null,
      error: 'permission denied for function get_my_app_access',
    })
  })

  it('parses a valid RPC row and rejects unverifiable payloads', async () => {
    mock.rpcData = [{
      status: 'active',
      app_role: 'app_admin',
      updated_at: '2026-07-16T12:00:00Z',
    }]
    await expect(loadCurrentAppAccess()).resolves.toEqual({
      access: {
        status: 'active',
        appRole: 'app_admin',
        updatedAt: '2026-07-16T12:00:00Z',
      },
      error: null,
    })

    mock.rpcData = [{ status: 'active', app_role: 'owner' }]
    await expect(loadCurrentAppAccess()).resolves.toEqual({
      access: null,
      error: 'Account access could not be verified.',
    })
  })
})
