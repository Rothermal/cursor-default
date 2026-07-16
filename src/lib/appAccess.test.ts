import { describe, expect, it } from 'vitest'
import {
  isMissingAppAccessRpcError,
  parseAccountAccessRows,
  parseAppAccess,
} from './appAccess'

describe('parseAppAccess', () => {
  it('normalizes the single-row RPC response', () => {
    expect(parseAppAccess([{
      status: 'active',
      app_role: 'app_admin',
      updated_at: '2026-07-16T12:00:00Z',
    }])).toEqual({
      status: 'active',
      appRole: 'app_admin',
      updatedAt: '2026-07-16T12:00:00Z',
    })
  })

  it('rejects unknown statuses and roles', () => {
    expect(parseAppAccess([{ status: 'disabled', app_role: 'user' }])).toBeNull()
    expect(parseAppAccess([{ status: 'active', app_role: 'owner' }])).toBeNull()
  })
})

describe('parseAccountAccessRows', () => {
  it('keeps valid app-admin list rows and drops malformed rows', () => {
    expect(parseAccountAccessRows([
      {
        user_id: 'user-1',
        display_name: 'Coach One',
        email: 'coach@example.com',
        status: 'pending',
        app_role: 'user',
        updated_at: null,
      },
      { user_id: 'user-2', status: 'active', app_role: 'user' },
    ])).toEqual([{
      userId: 'user-1',
      displayName: 'Coach One',
      email: 'coach@example.com',
      status: 'pending',
      appRole: 'user',
      updatedAt: null,
    }])
  })
})

describe('isMissingAppAccessRpcError', () => {
  it('recognizes PostgREST schema-cache and PostgreSQL missing-function errors', () => {
    expect(isMissingAppAccessRpcError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingAppAccessRpcError({ code: '42883' })).toBe(true)
    expect(isMissingAppAccessRpcError({ code: '42501', message: 'denied' })).toBe(false)
  })
})
