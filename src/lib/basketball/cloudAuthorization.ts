import type { GameState } from '../../types'
import { loadCurrentAppAccess, type AppAccess } from '../appAccess'
import { supabase } from '../supabase'
import { canTrackGames, parseTeamRole, type TeamRole } from '../teamPermissions'
import {
  ensureBasketballClockLineupCapabilities,
  type BasketballClockLineupCapabilityResult,
} from './clockLineupCapabilities'
import {
  ensureBasketballReleaseCapabilities,
  type BasketballReleaseCapabilityResult,
} from './releaseCapabilities'
import { isBasketballMatchRulesV3 } from './rules'

export interface BasketballAnchoredCloudAuthorizationDependencies {
  loadAppAccess: () => Promise<{ access: AppAccess | null; error: string | null }>
  loadTeamRole: (teamId: string) => Promise<TeamRole | null>
  loadReleaseCapabilities: (userId: string) => Promise<BasketballReleaseCapabilityResult>
  loadClockLineupCapabilities: (
    userId: string
  ) => Promise<BasketballClockLineupCapabilityResult>
}

export interface AuthorizeBasketballAnchoredCloudInput {
  state: GameState
  userId: string
  assertCurrent?: () => void
}

const defaultDependencies: BasketballAnchoredCloudAuthorizationDependencies = {
  loadAppAccess: loadCurrentAppAccess,
  loadTeamRole: loadFreshTeamRole,
  loadReleaseCapabilities: userId => ensureBasketballReleaseCapabilities(userId, { force: true }),
  loadClockLineupCapabilities: userId =>
    ensureBasketballClockLineupCapabilities(userId, { force: true }),
}

export function isBasketballAnchoredCloudAuthority(state: GameState): boolean {
  const sportState = state.sportGameState
  if (sportState?.sportId !== 'basketball') return false
  const rules = sportState.setup.rulesSnapshot
  return sportState.setup.version === 2 &&
    isBasketballMatchRulesV3(rules) &&
    rules.clockModel === 'anchored'
}

export function basketballEqualPlayAuthorityTeamId(state: GameState): string | null {
  if (isBasketballAnchoredCloudAuthority(state) && state.sportGameState?.sportId === 'basketball') {
    return state.sportGameState.setup.sourceTeamId
  }
  return state.cloudSync.teamId
}

export function canAuthorizeBasketballEqualPlayOverride(
  state: GameState,
  role: TeamRole | null
): boolean {
  return !basketballEqualPlayAuthorityTeamId(state) || canTrackGames(role)
}

export async function authorizeBasketballAnchoredCloudMutation(
  input: AuthorizeBasketballAnchoredCloudInput,
  dependencies: BasketballAnchoredCloudAuthorizationDependencies = defaultDependencies
): Promise<boolean> {
  const sportState = input.state.sportGameState
  if (sportState?.sportId !== 'basketball') {
    throw new Error('Basketball cloud authorization requires Basketball event authority.')
  }
  const rules = sportState.setup.rulesSnapshot
  const anchoredRules = isBasketballMatchRulesV3(rules) && rules.clockModel === 'anchored'
  if (!anchoredRules) return false
  if (sportState.setup.version !== 2) {
    throw new Error('Anchored Basketball cloud sync requires setup version 2.')
  }
  if (!input.userId.trim()) {
    throw new Error('Sign in again before syncing this Basketball clock game.')
  }

  const appAccess = await dependencies.loadAppAccess()
  input.assertCurrent?.()
  if (!appAccess.access || appAccess.access.status !== 'active') {
    throw new Error(appAccess.error ?? 'Your account is not active for Basketball cloud sync.')
  }

  if (sportState.setup.sourceTeamId) {
    const role = await dependencies.loadTeamRole(sportState.setup.sourceTeamId)
    input.assertCurrent?.()
    if (!canTrackGames(role)) {
      throw new Error('Your current team role cannot sync this Basketball clock game.')
    }
  }

  const [release, clockAndLineups] = await Promise.all([
    dependencies.loadReleaseCapabilities(input.userId),
    dependencies.loadClockLineupCapabilities(input.userId),
  ])
  input.assertCurrent?.()
  if (release.status !== 'ready') throw new Error(release.error)
  if (clockAndLineups.status !== 'ready') throw new Error(clockAndLineups.error)
  return true
}

async function loadFreshTeamRole(teamId: string): Promise<TeamRole | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('current_team_role', { p_team_id: teamId })
  if (error) throw new Error(`Basketball team access could not be checked: ${error.message}`)
  return parseTeamRole(data)
}
