import { canTrackGames, type TeamRole } from './teamPermissions'

export type CloudGameTrackingAccess =
  | { kind: 'allowed' }
  | {
      kind: 'checking'
      title: 'Checking game access'
      message: 'Confirming your role for this team...'
    }
  | {
      kind: 'denied'
      title: 'Game tracking unavailable'
      message: string
    }

/**
 * Fail-closed gate for live Game Tracker when a cloud team is bound.
 * Unknown/loading roles must not briefly unlock write surfaces for viewers.
 */
export function resolveCloudGameTrackingAccess(args: {
  teamId: string | null | undefined
  role: TeamRole | null
  loading: boolean
  error: string | null
}): CloudGameTrackingAccess {
  if (!args.teamId || canTrackGames(args.role)) return { kind: 'allowed' }
  if (args.loading && !args.error) {
    return {
      kind: 'checking',
      title: 'Checking game access',
      message: 'Confirming your role for this team...',
    }
  }
  return {
    kind: 'denied',
    title: 'Game tracking unavailable',
    message:
      args.error ??
      'Viewer access is read-only. You can review this game from Team Info without changing its stats.',
  }
}

/** Finalize requires a bound in-progress cloud game and an accepted tracking role. */
export function canFinalizeBoundCloudGame(args: {
  isConfigured: boolean
  hasUser: boolean
  hasSupabase: boolean
  gameId: string | null | undefined
  gameStatus: string | null | undefined
  role: TeamRole | null
}): boolean {
  return Boolean(
    args.isConfigured &&
      args.hasUser &&
      args.hasSupabase &&
      args.gameId &&
      args.gameStatus !== 'final' &&
      canTrackGames(args.role)
  )
}
