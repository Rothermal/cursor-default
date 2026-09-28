import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  buildSoccerShotInput,
  inspectSoccerHistory,
  recordSoccerShot,
  soccerPenaltyMark,
  soccerPeriodTimings,
  soccerQuickShotSavesOnShooter,
  soccerQuickShotSelection,
  soccerRestartSourceLine,
  soccerShotSourceAllowed,
  sortSoccerActorParticipants,
  SOCCER_TEAM_ACTOR_ID,
  type SoccerLiveResult,
  type SoccerShotOutcome,
  type SoccerShotSituation,
} from '../../lib/soccer'
import { soccerScoringDirection } from '../../lib/soccer/shotDetails'
import { gameSideDisplayName } from '../../lib/display'
import type { GameState } from '../../types'
import type { SoccerCaptureDraft } from './SoccerShotCaptureDialog'

interface SoccerQuickShotSheetProps {
  draft: SoccerCaptureDraft | null
  state: GameState
  recorderUserId: string | null
  busy: boolean
  /** Tracked participant to mark with a ring (last shooter this match). */
  lastShooterId: string | null
  onApply: (result: SoccerLiveResult) => boolean
  onClose: () => void
  onMoreDetails: (draft: SoccerCaptureDraft) => void
}

const OUTCOMES: Array<{ value: SoccerShotOutcome; label: string }> = [
  { value: 'goal', label: 'Goal' },
  { value: 'saved', label: 'Saved' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'off_target', label: 'Off target' },
  { value: 'woodwork', label: 'Woodwork' },
]

const SITUATION_LABELS: Record<SoccerShotSituation, string> = {
  open_play: 'Open play',
  penalty: 'Penalty',
  direct_free_kick: 'Direct free kick',
  corner_sequence: 'Corner sequence',
  other_set_piece: 'Other set piece',
}

/**
 * Live-only compact shot sheet (S1). The parent remounts it per draft via
 * `key`, so its choices start from the draft each time it opens.
 */
export default function SoccerQuickShotSheet(props: SoccerQuickShotSheetProps) {
  if (!props.draft) return null
  return <QuickShotSheet {...props} draft={props.draft} />
}

function QuickShotSheet({
  draft,
  state,
  recorderUserId,
  busy,
  lastShooterId,
  onApply,
  onClose,
  onMoreDetails,
}: SoccerQuickShotSheetProps & { draft: SoccerCaptureDraft }) {
  const projection = state.sportGameState?.sportId === 'soccer' ? state.sportGameState.projection : null
  const teamSide = draft.teamSide
  const trackedLabel = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentTeamLabel = gameSideDisplayName(state.gameInfo, 'opponent')
  const [outcome, setOutcome] = useState<SoccerShotOutcome | null>(draft.outcome ?? null)
  const [situation, setSituation] = useState<SoccerShotSituation>(draft.situation ?? 'open_play')
  const [sourceEventId, setSourceEventId] = useState<string | null>(draft.sourceEventId ?? null)
  const [shooterId, setShooterId] = useState<string | null>(null)
  const [assistStep, setAssistStep] = useState(false)
  const [assistId, setAssistId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onField = useMemo(
    () => projection
      ? sortSoccerActorParticipants(
          Object.values(projection.participants).filter(participant => participant.status === 'on_field')
        )
      : [],
    [projection]
  )
  const sourceLine = useMemo(() => {
    if (!sourceEventId || !soccerShotSourceAllowed(situation)) return null
    return soccerRestartSourceLine(
      sourceEventId,
      inspectSoccerHistory(state).activeEvents,
      soccerPeriodTimings(state)
    )
  }, [situation, sourceEventId, state])

  if (!projection) return null
  const goalkeeperId = onField.find(participant => participant.role.group === 'goalkeeper')?.participantId ?? null
  const scoringDirection = soccerScoringDirection(teamSide, projection.attackingDirection)
  const location = draft.location
    ? { ...draft.location, attackingDirection: scoringDirection }
    : situation === 'penalty'
      ? soccerPenaltyMark(scoringDirection)
      : null

  const save = (chosenOutcome: SoccerShotOutcome, chosenShooterId: string, chosenAssistId: string | null) => {
    if (busy) return
    const input = buildSoccerShotInput(soccerQuickShotSelection({
      teamSide,
      outcome: chosenOutcome,
      situation,
      sourceEventId,
      location,
      trackedLabel,
      opponentTeamLabel,
      shooterId: chosenShooterId,
      primaryCreatorId: chosenAssistId,
      trackedGoalkeeperId: goalkeeperId,
    }))
    const result = recordSoccerShot(state, input, { recorderUserId })
    if (!result.ok) {
      setError(result.message)
      onApply(result)
      return
    }
    if (onApply(result)) onClose()
  }

  // Tracked flow advances once both outcome and shooter are chosen, in either order.
  const advance = (nextOutcome: SoccerShotOutcome | null, nextShooterId: string | null) => {
    if (teamSide !== 'tracked' || !nextOutcome || !nextShooterId) return
    if (soccerQuickShotSavesOnShooter(nextOutcome, situation)) {
      save(nextOutcome, nextShooterId, null)
      return
    }
    setAssistStep(true)
  }

  const chooseOutcome = (value: SoccerShotOutcome) => {
    setOutcome(value)
    advance(value, shooterId)
  }

  const chooseShooter = (value: string) => {
    setShooterId(value)
    advance(outcome, value)
  }

  const moreDetails = () => onMoreDetails({
    mode: 'live',
    teamSide,
    location: draft.location,
    outcome: outcome ?? undefined,
    situation,
    sourceEventId,
    shooterId: shooterId ?? undefined,
    primaryCreatorId: assistId,
  })

  const clearSource = () => {
    setSituation('open_play')
    setSourceEventId(null)
  }

  const teammates = onField.filter(participant => participant.participantId !== shooterId)
  const sideLabel = teamSide === 'tracked' ? trackedLabel : opponentTeamLabel

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-quick-shot-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-lg sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-quick-shot-title" className="truncate font-bold text-content" title={sideLabel}>{sideLabel} shot</h2>
            <p className="text-xs text-content-muted">{location ? `${Math.round(location.x * 100)}, ${Math.round(location.y * 100)}` : 'Location unknown'}</p>
          </div>
          <button type="button" onClick={onClose} className="h-11 w-11 grid place-items-center text-content-muted" aria-label="Close" title="Close"><X size={20} /></button>
        </header>

        <div className="space-y-4 p-4">
          {situation !== 'open_play' && (
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface-muted pl-3">
              <p className="min-w-0 flex-1 text-xs text-content">
                <span className="font-bold">{SITUATION_LABELS[situation]}</span>
                {sourceLine && <span className="text-content-muted"> · {sourceLine}</span>}
              </p>
              <button
                type="button"
                onClick={clearSource}
                className="h-11 w-11 shrink-0 grid place-items-center text-content-muted"
                aria-label="Clear restart link"
                title="Clear restart link"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {!assistStep && (
            <section>
              <p className="mb-1 text-[11px] font-bold uppercase text-content-muted">Outcome</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Outcome">
                {OUTCOMES.map(option => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={outcome === option.value}
                    onClick={() => chooseOutcome(option.value)}
                  />
                ))}
              </div>
            </section>
          )}

          {teamSide === 'tracked' && !assistStep && (
            <section>
              <p className="mb-1 text-[11px] font-bold uppercase text-content-muted">Shooter</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Shooter">
                {onField.map(participant => (
                  <Chip
                    key={participant.participantId}
                    label={participantLabel(participant)}
                    active={shooterId === participant.participantId}
                    ringed={participant.participantId === lastShooterId}
                    onClick={() => chooseShooter(participant.participantId)}
                  />
                ))}
                <Chip
                  label="Team"
                  active={shooterId === SOCCER_TEAM_ACTOR_ID}
                  onClick={() => chooseShooter(SOCCER_TEAM_ACTOR_ID)}
                />
              </div>
            </section>
          )}

          {teamSide === 'tracked' && assistStep && outcome && shooterId && (
            <section>
              <p className="mb-3 text-sm font-semibold text-content">
                {OUTCOMES.find(option => option.value === outcome)?.label} by {shooterId === SOCCER_TEAM_ACTOR_ID ? 'Team' : participantLabel(onField.find(participant => participant.participantId === shooterId) ?? { displayName: 'Unknown', number: null })}
              </p>
              <p className="mb-1 text-[11px] font-bold uppercase text-content-muted">Assisted by</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Assisted by">
                {teammates.map(participant => (
                  <Chip
                    key={participant.participantId}
                    label={participantLabel(participant)}
                    active={assistId === participant.participantId}
                    onClick={() => setAssistId(current => current === participant.participantId ? null : participant.participantId)}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => save(outcome, shooterId, null)} className="min-h-12 rounded-md border border-line-strong bg-surface px-3 text-sm font-bold text-content disabled:text-content-disabled">Skip</button>
                <button type="button" disabled={busy || !assistId} onClick={() => save(outcome, shooterId, assistId)} className="min-h-12 rounded-md bg-success px-3 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled">Save</button>
              </div>
            </section>
          )}

          {teamSide === 'opponent' && (
            <button
              type="button"
              disabled={busy || !outcome}
              onClick={() => outcome && save(outcome, SOCCER_TEAM_ACTOR_ID, null)}
              className="min-h-12 w-full rounded-md bg-success px-4 text-sm font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
            >
              Save
            </button>
          )}

          {error && <p role="alert" className="border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>}

          <button type="button" onClick={moreDetails} className="min-h-11 w-full text-sm font-bold text-success-content">
            More details
          </button>
        </div>
      </div>
    </div>
  )
}

function Chip({ label, active, ringed = false, onClick }: { label: string; active: boolean; ringed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 min-w-0 truncate rounded-md px-1.5 text-xs font-bold ${active ? 'bg-accent text-accent-content' : 'border border-line-strong bg-surface text-content'} ${ringed && !active ? 'ring-2 ring-offset-1 ring-offset-surface ring-success-line' : ''}`}
    >
      {label}
      {ringed && <span className="sr-only"> (last shooter)</span>}
    </button>
  )
}

function participantLabel(participant: { displayName: string; number: string | null }): string {
  return `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
}
