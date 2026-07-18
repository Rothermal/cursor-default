import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  configured: true,
  lastRpc: null as { name: string; args?: Record<string, unknown> } | null,
  rpcData: null as unknown,
  rpcError: null as { message?: string } | null,
}))

vi.mock('./supabase', () => ({
  get supabase() {
    if (!mock.configured) return null
    return {
      rpc: (name: string, args?: Record<string, unknown>) => {
        mock.lastRpc = { name, args }
        return Promise.resolve({ data: mock.rpcData, error: mock.rpcError })
      },
    }
  },
}))

import { listAccountAccess, updateAccountAccess } from './appAccess'

describe('listAccountAccess', () => {
  beforeEach(() => {
    mock.configured = true
    mock.lastRpc = null
    mock.rpcData = null
    mock.rpcError = null
  })

  it('fails closed when Supabase is not configured', async () => {
    mock.configured = false
    await expect(listAccountAccess('coach')).resolves.toEqual({
      accounts: [],
      error: 'Supabase not configured',
    })
    expect(mock.lastRpc).toBeNull()
  })

  it('trims search, parses rows, and surfaces RPC errors', async () => {
    mock.rpcData = [{
      user_id: 'user-1',
      display_name: 'Coach One',
      email: null,
      status: 'active',
      app_role: 'app_admin',
      updated_at: '2026-07-18T09:00:00Z',
    }]
    await expect(listAccountAccess('  coach  ')).resolves.toEqual({
      accounts: [{
        userId: 'user-1',
        displayName: 'Coach One',
        email: null,
        status: 'active',
        appRole: 'app_admin',
        updatedAt: '2026-07-18T09:00:00Z',
      }],
      error: null,
    })
    expect(mock.lastRpc).toEqual({
      name: 'list_account_access',
      args: { p_search: 'coach' },
    })

    mock.rpcError = { message: 'permission denied for function list_account_access' }
    await expect(listAccountAccess('')).resolves.toEqual({
      accounts: [],
      error: 'permission denied for function list_account_access',
    })
    expect(mock.lastRpc).toEqual({
      name: 'list_account_access',
      args: { p_search: null },
    })
  })
})

describe('updateAccountAccess', () => {
  beforeEach(() => {
    mock.configured = true
    mock.lastRpc = null
    mock.rpcData = null
    mock.rpcError = null
  })

  it('writes status and role through set_account_access', async () => {
    await expect(updateAccountAccess('user-9', 'suspended', 'user')).resolves.toEqual({
      error: null,
    })
    expect(mock.lastRpc).toEqual({
      name: 'set_account_access',
      args: {
        p_user_id: 'user-9',
        p_status: 'suspended',
        p_app_role: 'user',
      },
    })
  })

  it('fails closed when Supabase is missing or the RPC errors', async () => {
    mock.configured = false
    await expect(updateAccountAccess('user-9', 'active', 'app_admin')).resolves.toEqual({
      error: 'Supabase not configured',
    })

    mock.configured = true
    mock.rpcError = { message: 'cannot demote the last app admin' }
    await expect(updateAccountAccess('user-9', 'active', 'user')).resolves.toEqual({
      error: 'cannot demote the last app admin',
    })
  })
})
