import { X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  hockeyAvailableParticipants,
  hockeyScorerChoices,
  otherHockeySide,
  type HockeyActorChoice,
  type HockeyPlayKind,
  type HockeySide,
  type HockeySportGameState,
  type HockeyTeamEventKind,
  type RecordHockeyPlayInput,
} from '../../lib/hockey'
import { ActorField, Choices, Group } from './hockeyFields'

/** Plays by a player, plus team-only events: timeouts (HKY-3B), icing and offside. */
export type HockeyPlayDialogKind = HockeyPlayKind | HockeyTeamEventKind | 'timeout'

export interface HockeyTeamPlayInput {
  kind: HockeyTeamEventKind | 'timeout'
  side: HockeySide
  location: { x: number; y: number } | null
}

export interface HockeyPlayDraft {
  kind: HockeyPlayDialogKind
  location: { x: number; y: number } | null
}

interface HockeyPlayDialogProps {
  draft: HockeyPlayDraft
  sport: HockeySportGameState
  recentOpponentLabels: string[]
  trackedLabel: string
  opponentLabel: string
  /** Returns an error message, or null once the play is recorded. */
  onSubmit: (input: RecordHockeyPlayInput) => string | null
  /** Timeouts, icing and offside; returns an error message, or null once recorded. */
  onTeamSubmit: (input: HockeyTeamPlayInput) => string | null
  onClose: () => void
}

const TITLES: Record<HockeyPlayDialogKind, string> = {
  hit: 'Hit',
  takeaway: 'Takeaway',
  giveaway: 'Giveaway',
  timeout: 'Timeout',
  icing: 'Icing',
  offside: 'Offside',
}
const KINDS: HockeyPlayDialogKind[] = ['hit', 'takeaway', 'giveaway', 'timeout', 'icing', 'offside']
const isTeamKind = (kind: HockeyPlayDialogKind): kind is HockeyTeamPlayInput['kind'] =>
  kind === 'timeout' || kind === 'icing' || kind === 'offside'

/**
 * Hits, takeaways and giveaways (HKY-2C), with timeouts, icing and offside (HKY-3B). Every
 * player field is optional; team events record only the side.
 */
export default function HockeyPlayDialog({
  draft,
  sport,
  recentOpponentLabels,
  trackedLabel,
  opponentLabel,
  onSubmit,
  onTeamSubmit,
  onClose,
}: HockeyPlayDialogProps) {
  const titleId = useId()
  const [kind, setKind] = useState<HockeyPlayDialogKind>(draft.kind)
  const [side, setSide] = useState<HockeySide>('tracked')
  const [player, setPlayer] = useState('')
  const [hitPlayer, setHitPlayer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sideName = (value: HockeySide) => (value === 'tracked' ? trackedLabel : opponentLabel)
  const choices = hockeyAvailableParticipants(hockeyScorerChoices(sport.setup), sport.projection)

  const choice = (owner: HockeySide, value: string): HockeyActorChoice | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    return owner === 'tracked' ? { participantId: trimmed } : { label: trimmed }
  }

  const team = isTeamKind(kind)
  const submit = () => {
    if (isTeamKind(kind)) {
      const message = onTeamSubmit({ kind, side, location: kind === 'timeout' ? null : draft.location })
      if (message) setError(message)
      return
    }
    const message = onSubmit({
      kind,
      side,
      player: choice(side, player),
      hitPlayer: kind === 'hit' ? choice(otherHockeySide(side), hitPlayer) : null,
      location: draft.location,
    })
    if (message) setError(message)
  }

  return (
    <div className="fixed inset-0 z-50 bg-overlay/[0.5] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-bold text-content">{TITLES[kind]}</h2>
            <p className="text-xs text-content-muted">
              {kind === 'timeout' ? 'Pauses a running clock' : draft.location ? 'Located on the rink' : 'No location'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className="space-y-4 p-4">
          <Group label="Play">
            <Choices
              options={KINDS.map(value => ({ value, label: TITLES[value] }))}
              value={kind}
              onChange={value => { setKind(value); setError(null) }}
              columns={3}
            />
          </Group>
          <Group label={kind === 'hit' ? 'Hitting side' : kind === 'timeout' ? 'Timeout for' : team ? 'Called against' : 'Side'}>
            <Choices
              options={(['tracked', 'opponent'] as const).map(value => ({ value, label: sideName(value) }))}
              value={side}
              onChange={value => { setSide(value); setPlayer(''); setHitPlayer(''); setError(null) }}
            />
          </Group>
          {!team && <ActorField
            label={kind === 'hit' ? 'Hit by' : 'Player'}
            owner={side}
            value={player}
            onChange={setPlayer}
            trackedOptions={choices}
            recentLabels={recentOpponentLabels}
            emptyLabel="Unknown"
          />}
          {kind === 'hit' && (
            <ActorField
              label="Player hit"
              owner={otherHockeySide(side)}
              value={hitPlayer}
              onChange={setHitPlayer}
              trackedOptions={choices}
              recentLabels={recentOpponentLabels}
              emptyLabel="Unknown"
            />
          )}
          {error && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
          )}
          <button type="button" className="btn-primary w-full" onClick={submit}>Record {TITLES[kind].toLowerCase()}</button>
        </div>
      </div>
    </div>
  )
}
