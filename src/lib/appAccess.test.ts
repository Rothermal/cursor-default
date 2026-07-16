import { describe, expect, it } from 'vitest'
import {
  applyAppAccessDenial,
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
    expect(isMissingAppAccessRpcError({
      message: 'Could not find the function public.get_my_app_access without parameters in the schema cache',
    })).toBe(true)
    expect(isMissingAppAccessRpcError({ code: '42501', message: 'denied' })).toBe(false)
    expect(isMissingAppAccessRpcError(null)).toBe(false)
  })
})

describe('applyAppAccessDenial', () => {
  it('locks the UI to pending/suspended while preserving the prior app role', () => {
    expect(applyAppAccessDenial(
      { status: 'active', appRole: 'app_admin', updatedAt: '2026-07-16T12:00:00Z' },
      'APP_ACCESS_PENDING'
    )).toEqual({
      access: { status: 'pending', appRole: 'app_admin', updatedAt: null },
      error: null,
    })

    expect(applyAppAccessDenial(null, 'APP_ACCESS_SUSPENDED')).toEqual({
      access: { status: 'suspended', appRole: 'user', updatedAt: null },
      error: null,
    })
  })

  it('clears access when verification is unavailable', () => {
    expect(applyAppAccessDenial(
      { status: 'active', appRole: 'user', updatedAt: null },
      'APP_ACCESS_UNAVAILABLE'
    )).toEqual({
      access: null,
      error: 'Account access could not be verified.',
    })
  })
})
