import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import {
  setSoccerLineupDefaultStatus,
  soccerLineupDefaultStatusForPlayer,
  type SoccerTeamLineupDefaultsV1,
} from '../../lib/soccer/lineupDefaults'
import {
  deriveSoccerLineupDefaultsEditorState,
  type SoccerLineupDefaultsRosterPlayer,
} from '../../lib/soccer/lineupDefaultsEditor'
import type { SoccerRole } from '../../lib/soccer/types'

export default function SoccerLineupDefaultsEditor({
  defaults,
  maxOnFieldPlayers,
  roster,
  rosterReady,
  rosterLoading,
  stalePlayerCount,
  stalePlayerCountReady,
  readOnly,
  onChange,
}: {
  defaults: SoccerTeamLineupDefaultsV1
  maxOnFieldPlayers: number
  roster: readonly SoccerLineupDefaultsRosterPlayer[]
  rosterReady: boolean
  rosterLoading: boolean
  stalePlayerCount: number
  stalePlayerCountReady: boolean
  readOnly: boolean
  onChange: (defaults: SoccerTeamLineupDefaultsV1) => void
}) {
  const editorState = useMemo(
    () => deriveSoccerLineupDefaultsEditorState(defaults, roster, maxOnFieldPlayers),
    [defaults, maxOnFieldPlayers, roster]
  )

  if (!rosterReady) {
    return (
      <p className="text-sm text-content-muted" role="status">
        {rosterLoading ? 'Loading active roster...' : 'Active roster unavailable.'}
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h3 className="text-sm font-semibold text-content">Default match status</h3>
          <p className="text-xs text-content-muted">Active roster players only</p>
        </div>
        <span className="shrink-0 text-sm font-bold text-success-content">
          Starters {editorState.starters.length} / {maxOnFieldPlayers}
        </span>
      </div>

      {editorState.warnings.length > 0 && (
        <div className="space-y-2" aria-label="Lineup default warnings">
          {editorState.warnings.map(warning => (
            <p
              key={warning}
              role="status"
              className="flex gap-2 rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content"
            >
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      {stalePlayerCountReady && stalePlayerCount > 0 && (
        <p role="status" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          {stalePlayerCount} saved {stalePlayerCount === 1 ? 'player is' : 'players are'} no longer on this team. Saving this tab will remove {stalePlayerCount === 1 ? 'that entry' : 'those entries'}.
        </p>
      )}
      {!stalePlayerCountReady && (
        <p role="status" className="text-sm text-content-muted">
          Saved lineup cleanup is unavailable until team membership finishes loading.
        </p>
      )}

      <LineupGroup
        title="Starters"
        players={editorState.starters}
        defaults={defaults}
        readOnly={readOnly}
        onChange={onChange}
      />
      <LineupGroup
        title="Bench"
        players={editorState.bench}
        defaults={defaults}
        readOnly={readOnly}
        onChange={onChange}
      />
    </div>
  )
}

function LineupGroup({
  title,
  players,
  defaults,
  readOnly,
  onChange,
}: {
  title: string
  players: readonly SoccerLineupDefaultsRosterPlayer[]
  defaults: SoccerTeamLineupDefaultsV1
  readOnly: boolean
  onChange: (defaults: SoccerTeamLineupDefaultsV1) => void
}) {
  return (
    <section aria-labelledby={`lineup-${title.toLowerCase()}-heading`}>
      <div className="flex items-center justify-between border-b border-line pb-2">
        <h3 id={`lineup-${title.toLowerCase()}-heading`} className="text-sm font-bold text-content">
          {title}
        </h3>
        <span className="text-xs font-semibold text-content-muted">{players.length}</span>
      </div>
      {players.length === 0 ? (
        <p className="py-4 text-sm text-content-muted">No {title.toLowerCase()}.</p>
      ) : (
        <div role="list">
          {players.map(player => {
            const status = soccerLineupDefaultStatusForPlayer(defaults, player.id)
            return (
              <div
                key={player.id}
                role="listitem"
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content">{player.name}</p>
                  <p className="truncate text-xs text-content-muted">
                    {roleLabel(player.role)}{player.number ? ` / #${player.number}` : ''}
                  </p>
                </div>
                {readOnly ? (
                  <span className="text-xs font-bold text-content-muted">
                    {status === 'starter' ? 'Starter' : 'Bench'}
                  </span>
                ) : (
                  <div
                    className="grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-1"
                    role="group"
                    aria-label={`${player.name} default status`}
                  >
                    {(['starter', 'bench'] as const).map(option => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => onChange(
                          setSoccerLineupDefaultStatus(defaults, player.id, option)
                        )}
                        aria-pressed={status === option}
                        className={`h-8 min-w-16 rounded px-2 text-xs font-bold ${
                          status === option
                            ? 'bg-surface text-success-content shadow-sm'
                            : 'text-content-muted'
                        }`}
                      >
                        {option === 'starter' ? 'Starter' : 'Bench'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function roleLabel(role: SoccerRole): string {
  switch (role.group) {
    case 'forward': return 'Forward'
    case 'midfielder': return 'Midfielder'
    case 'defender': return 'Defender'
    case 'goalkeeper': return 'Goalkeeper'
    case 'custom': return role.label?.trim() || 'Custom'
    default: return 'Custom'
  }
}
