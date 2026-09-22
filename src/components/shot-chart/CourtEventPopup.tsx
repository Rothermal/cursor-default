import { useEffect, useRef, useState } from 'react'
import type { Player } from '../../types'
import { reboundPromptOptionsForMiss, type ReboundStatId } from '../../lib/reboundPrompt'
import { isTeamPseudoPlayer } from '../../lib/teamPlayers'
import { sideOf } from '../../lib/shotChartViews'
import ActorSelect from '../ActorSelect'
import { assistCandidatesForMadeShot } from '../../lib/assistCandidates'

const ARMING_DELAY_MS = 300
const COURT_STAT_EVENTS = [
  { statId: 'oreb', label: 'Off Reb' }, { statId: 'dreb', label: 'Def Reb' },
  { statId: 'stl', label: 'Steal' }, { statId: 'blk', label: 'Block' },
  { statId: 'ast', label: 'Assist' },
] as const
type CourtStatEventId = (typeof COURT_STAT_EVENTS)[number]['statId']
export interface CourtReboundChoice { statId: ReboundStatId; playerId: string }
export type CourtEvent =
  | { kind: 'shot'; made: boolean; shotType: '2pt' | '3pt'; assistPlayerId?: string; rebound?: CourtReboundChoice }
  | { kind: 'stat'; statId: CourtStatEventId }

interface CourtEventPopupProps {
  playerLabel: string
  playerStatLine?: string
  players: Player[]
  playerLabels?: Record<string, string>
  activePlayerId: string
  captureSide?: 'home' | 'opponent'
  onSelectPlayer: (playerId: string) => void
  reboundPromptAfterMissEnabled?: boolean
  shotType: '2pt' | '3pt'
  onShotTypeChange?: (shotType: '2pt' | '3pt') => void
  errorMessage?: string | null
  shotDisabledMessage?: string | null
  onAdministrative?: (kind: 'foul' | 'free_throw') => void
  onPick: (event: CourtEvent) => void
  onCancel: () => void
}

const labelFor = (player: Player) => `#${player.number || '?'} ${player.name}`

export default function CourtEventPopup({ playerLabel, playerStatLine, players, activePlayerId,
  playerLabels,
  captureSide, onSelectPlayer, reboundPromptAfterMissEnabled = false, shotType,
  onShotTypeChange, errorMessage, shotDisabledMessage, onAdministrative, onPick, onCancel,
}: CourtEventPopupProps) {
  const [value, setValue] = useState(shotType)
  const [step, setStep] = useState<'event' | 'assist' | 'rebound'>('event')
  const [assister, setAssister] = useState('')
  const [offensive, setOffensive] = useState<string | null>(null)
  const [defensive, setDefensive] = useState<string | null>(null)
  const openedAt = useRef(Date.now())
  const armed = useRef(false)
  const selected = players.find(player => player.id === activePlayerId)
  const side = captureSide ?? (selected ? sideOf(selected) : 'home')
  const sidePlayers = players.filter(player => sideOf(player) === side)
  const assists = assistCandidatesForMadeShot(sidePlayers, activePlayerId)
  const rebounds = reboundPromptOptionsForMiss(players, activePlayerId)
  const options = (rows: Player[]) => rows.filter(player => !isTeamPseudoPlayer(player))
    .map(player => ({ value: player.id, label: playerLabels?.[player.id] ?? labelFor(player) }))
  const unattributed = (rows: Player[]) => {
    const team = rows.find(isTeamPseudoPlayer)
    return team ? { value: team.id, label: 'Unattributed' } : null
  }
  const guarded = (action: () => void) => {
    if (!armed.current) return
    armed.current = false
    action()
  }
  useEffect(() => setValue(shotType), [shotType])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onCancel])
  const shot = (made: boolean, extra: { assistPlayerId?: string; rebound?: CourtReboundChoice } = {}) =>
    onPick({ kind: 'shot', made, shotType: value, ...extra })
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/[0.4] px-4"
    onPointerDownCapture={() => { if (Date.now() - openedAt.current >= ARMING_DELAY_MS) armed.current = true }}
    onKeyDownCapture={event => { if (event.key === 'Enter' || event.key === ' ') armed.current = true }}
    onClick={() => guarded(onCancel)}>
    <section role="dialog" aria-modal="true" aria-label="Record court event"
      className="max-h-[90dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-lg bg-surface p-4 shadow-xl"
      onClick={event => event.stopPropagation()}>
      {errorMessage && <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">{errorMessage}</p>}
      <ActorSelect label="Log for" value={activePlayerId} options={options(sidePlayers)}
        emptyOption={unattributed(sidePlayers)} disabled={step !== 'event'} onChange={onSelectPlayer} />
      {playerStatLine && <p className="break-words text-xs text-content-subtle">{playerStatLine}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-content-subtle">Shot value</span>
        <div className="grid grid-cols-2 rounded-lg border border-line bg-control p-1">
          {(['2pt', '3pt'] as const).map(type => <button key={type} type="button" disabled={step !== 'event'}
            aria-pressed={value === type} className={`rounded px-4 py-2 text-sm font-bold ${value === type ? 'bg-surface text-content' : 'text-content-subtle'}`}
            onClick={() => guarded(() => { setValue(type); onShotTypeChange?.(type) })}>{type === '2pt' ? '2PT' : '3PT'}</button>)}
        </div>
      </div>
      {step === 'assist' ? <>
        <ActorSelect label="Assisted by" value={assister} options={options(assists)} emptyOption={{ value: '', label: 'No assist' }} onChange={setAssister} />
        <button type="button" className="btn-primary w-full" onClick={() => guarded(() => shot(true, { assistPlayerId: assister || undefined }))}>Save made shot</button>
      </> : step === 'rebound' ? <>
        <p className="text-sm text-content">Rebound after {playerLabel}'s miss</p>
        {rebounds && ([['oreb', 'Offensive rebound', rebounds.offensiveCandidates, offensive],
          ['dreb', 'Defensive rebound', rebounds.defensiveCandidates, defensive]] as const).map(([statId, label, candidates, playerId]) => <div key={statId} className="space-y-2">
          <ActorSelect label={label} value={playerId ?? ''} options={options(candidates)} emptyOption={unattributed(candidates)}
            onChange={id => statId === 'oreb' ? setOffensive(id) : setDefensive(id)} />
          <button type="button" className="btn-secondary w-full" disabled={!playerId}
            onClick={() => guarded(() => { if (playerId) shot(false, { rebound: { statId, playerId } }) })}>
            {statId === 'oreb' ? 'Off Reb' : 'Def Reb'}
          </button>
        </div>)}
        <button type="button" className="btn-secondary w-full" onClick={() => guarded(() => shot(false))}>No rebound</button>
      </> : <>
        {shotDisabledMessage && <p role="status" className="text-sm text-warning-content">{shotDisabledMessage}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={Boolean(shotDisabledMessage)} className="rounded-lg bg-success py-4 font-bold text-success-content disabled:bg-control-disabled disabled:text-content-disabled"
            onClick={() => guarded(() => assists.length ? setStep('assist') : shot(true))}>Made</button>
          <button type="button" disabled={Boolean(shotDisabledMessage)} className="rounded-lg bg-danger py-4 font-bold text-danger-content disabled:bg-control-disabled disabled:text-content-disabled"
            onClick={() => guarded(() => {
              if (reboundPromptAfterMissEnabled && rebounds) {
                setOffensive(rebounds.defaultOffensivePlayerId); setDefensive(rebounds.defaultDefensivePlayerId); setStep('rebound')
              } else shot(false)
            })}>Missed</button>
        </div>
        <div className="grid grid-cols-3 gap-2">{COURT_STAT_EVENTS.map(({ statId, label }) => <button key={statId} type="button"
          className="min-h-11 rounded-lg border border-line bg-control px-1 text-sm font-semibold text-content"
          onClick={() => guarded(() => onPick({ kind: 'stat', statId }))}>{label}</button>)}</div>
        {onAdministrative && <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => guarded(() => onAdministrative('foul'))}>Foul</button>
          <button type="button" className="btn-secondary" onClick={() => guarded(() => onAdministrative('free_throw'))}>Free Throw</button>
        </div>}
      </>}
      <button type="button" className="btn-secondary w-full" onClick={() => guarded(onCancel)}>Cancel</button>
    </section>
  </div>
}
