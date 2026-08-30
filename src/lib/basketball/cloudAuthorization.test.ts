import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import {
  authorizeBasketballAnchoredCloudMutation,
  basketballEqualPlayAuthorityTeamId,
  canAuthorizeBasketballEqualPlayOverride,
  isBasketballAnchoredCloudAuthority,
  type BasketballAnchoredCloudAuthorizationDependencies,
} from './cloudAuthorization'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from './profiles'

const readyRelease = {
  status: 'ready' as const,
  capabilities: {
    contractVersion: 2 as const,
    migration: 62 as const,
    eventTransportVersion: 4 as const,
    recoveryVersion: 1 as const,
    recorderResolutionVersion: 1 as const,
    canonicalFinalizationVersion: 1 as const,
    summaryAuthorityVersion: 1 as const,
    aggregateSourceVersion: 1 as const,
    settingsContractVersion: 1 as const,
  },
}

function state(sourceTeamId: string | null = null): GameState {
  const rules = upgradeBasketballRulesDraftToV3(
    getBasketballRulesProfile('nfhs', 1)!.rules,
    'nfhs'
  )
  return {
    ...createInitialState(),
    gameDataAuthority: 'sport_events',
    sportGameState: {
      sportId: 'basketball',
      version: 1,
      setup: {
        version: 2,
        sourceTeamId,
        sourceSeasonId: sourceTeamId ? 'season-1' : null,
        rulesSnapshot: rules,
      },
      projection: {},
    },
  } as unknown as GameState
}

function dependencies(
  overrides: Partial<BasketballAnchoredCloudAuthorizationDependencies> = {}
): BasketballAnchoredCloudAuthorizationDependencies {
  return {
    loadAppAccess: vi.fn(async () => ({
      access: { status: 'active' as const, appRole: 'user' as const, updatedAt: null },
      error: null,
    })),
    loadTeamRole: vi.fn(async () => 'scorer' as const),
    loadReleaseCapabilities: vi.fn(async () => readyRelease),
    loadClockLineupCapabilities: vi.fn(async () => ({
      status: 'ready' as const,
      capabilities: { clockAndLineupsVersion: 1 as const },
    })),
    ...overrides,
  }
}

describe('Basketball anchored cloud authorization', () => {
  it('classifies only exact setup-v2 anchored authority', () => {
    const anchored = state()
    expect(isBasketballAnchoredCloudAuthority(anchored)).toBe(true)

    const clockless = structuredClone(anchored)
    if (clockless.sportGameState?.sportId !== 'basketball') throw new Error('missing state')
    const rules = clockless.sportGameState.setup.rulesSnapshot
    if (rules.rulesSchemaVersion !== 3) throw new Error('missing rules')
    rules.clockModel = 'none'
    expect(isBasketballAnchoredCloudAuthority(clockless)).toBe(false)

    const oldSetup = structuredClone(anchored)
    if (oldSetup.sportGameState?.sportId !== 'basketball') throw new Error('missing state')
    Object.assign(oldSetup.sportGameState.setup, { version: 1 })
    expect(isBasketballAnchoredCloudAuthority(oldSetup)).toBe(false)
  })

  it('uses immutable anchored team authority for every equal-play override role', () => {
    const teamState = state('team-1')
    const resolved = (role: 'owner' | 'admin' | 'scorer' | 'viewer' | null) => ({
      role,
      loading: false,
      error: null,
    })
    expect(teamState.cloudSync.teamId).toBeNull()
    expect(basketballEqualPlayAuthorityTeamId(teamState)).toBe('team-1')
    expect(canAuthorizeBasketballEqualPlayOverride(teamState, resolved('owner'))).toBe(true)
    expect(canAuthorizeBasketballEqualPlayOverride(teamState, resolved('admin'))).toBe(true)
    expect(canAuthorizeBasketballEqualPlayOverride(teamState, resolved('scorer'))).toBe(true)
    expect(canAuthorizeBasketballEqualPlayOverride(teamState, resolved('viewer'))).toBe(false)
    expect(canAuthorizeBasketballEqualPlayOverride(teamState, resolved(null))).toBe(false)

    const personalState = state()
    expect(basketballEqualPlayAuthorityTeamId(personalState)).toBeNull()
    expect(canAuthorizeBasketballEqualPlayOverride(personalState, resolved(null))).toBe(true)
  })

  it('keeps an unresolved local-only team role playable without weakening cloud authority', () => {
    const localOnly = state('team-1')
    localOnly.cloudSync.eventCloudPolicy = 'local_only'

    expect(canAuthorizeBasketballEqualPlayOverride(localOnly, {
      role: null,
      loading: true,
      error: null,
    })).toBe(true)
    expect(canAuthorizeBasketballEqualPlayOverride(localOnly, {
      role: null,
      loading: false,
      error: 'Network unavailable',
    })).toBe(true)
    expect(canAuthorizeBasketballEqualPlayOverride(localOnly, {
      role: null,
      loading: false,
      error: null,
    })).toBe(false)

    const cloudBound = structuredClone(localOnly)
    cloudBound.cloudSync.eventCloudPolicy = 'automatic'
    cloudBound.cloudSync.teamId = 'team-1'
    expect(canAuthorizeBasketballEqualPlayOverride(cloudBound, {
      role: null,
      loading: true,
      error: null,
    })).toBe(false)
  })

  it('fresh-checks app, team, release, and clock authority before mutation', async () => {
    const deps = dependencies()
    const assertCurrent = vi.fn()
    await expect(authorizeBasketballAnchoredCloudMutation({
      state: state('team-1'),
      userId: 'user-1',
      assertCurrent,
    }, deps)).resolves.toBe(true)

    expect(deps.loadAppAccess).toHaveBeenCalledOnce()
    expect(deps.loadTeamRole).toHaveBeenCalledWith('team-1')
    expect(deps.loadReleaseCapabilities).toHaveBeenCalledWith('user-1')
    expect(deps.loadClockLineupCapabilities).toHaveBeenCalledWith('user-1')
    expect(assertCurrent).toHaveBeenCalledTimes(3)
  })

  it('does not call the clock capability for clockless authority', async () => {
    const clockless = state()
    if (clockless.sportGameState?.sportId !== 'basketball') throw new Error('missing state')
    const rules = clockless.sportGameState.setup.rulesSnapshot
    if (rules.rulesSchemaVersion !== 3) throw new Error('missing rules')
    rules.clockModel = 'none'
    const deps = dependencies()

    await expect(authorizeBasketballAnchoredCloudMutation({
      state: clockless,
      userId: 'user-1',
    }, deps)).resolves.toBe(false)
    expect(deps.loadAppAccess).not.toHaveBeenCalled()
    expect(deps.loadClockLineupCapabilities).not.toHaveBeenCalled()
  })

  it('rejects stale team access before either capability check', async () => {
    const deps = dependencies({ loadTeamRole: vi.fn(async () => 'viewer' as const) })
    await expect(authorizeBasketballAnchoredCloudMutation({
      state: state('team-1'),
      userId: 'user-1',
    }, deps)).rejects.toThrow('current team role')
    expect(deps.loadReleaseCapabilities).not.toHaveBeenCalled()
    expect(deps.loadClockLineupCapabilities).not.toHaveBeenCalled()
  })

  it('rejects either capability failure and an account change before mutation', async () => {
    const unavailable = dependencies({
      loadClockLineupCapabilities: vi.fn(async () => ({
        status: 'offline' as const,
        error: 'Basketball clock cloud support could not be checked while offline.',
      })),
    })
    await expect(authorizeBasketballAnchoredCloudMutation({
      state: state(),
      userId: 'user-1',
    }, unavailable)).rejects.toThrow('while offline')

    const changed = dependencies()
    await expect(authorizeBasketballAnchoredCloudMutation({
      state: state(),
      userId: 'user-1',
      assertCurrent: () => { throw new Error('account changed') },
    }, changed)).rejects.toThrow('account changed')
    expect(changed.loadReleaseCapabilities).not.toHaveBeenCalled()
  })
})
