import { ChevronLeft, Menu, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BaseballDiamond from '../components/baseball/BaseballDiamond'
import BaseballPitchPad from '../components/baseball/BaseballPitchPad'
import BaseballScoreboard from '../components/baseball/BaseballScoreboard'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  baseballDiamondView,
  baseballFieldingPositionCode,
  baseballLineScoreView,
  baseballScoreboardView,
  baseballSportState,
  findBaseballRulesProfile,
  setBaseballCapturePreferences,
  startBaseballGame,
  type BaseballMatchSetup,
  type BaseballPitchLocation,
  type BaseballSportGameState,
} from '../lib/baseball'
import { isBaseballEventPreviewAvailable } from '../lib/sportAvailability'

const BATTING_FORMAT_LABELS: Record<string, string> = {
  standard: 'Standard (nine bat)',
  designated_hitter: 'Designated hitter',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous order',
}

/**
 * The live Baseball tracker (BSB-3A shell): the scoreboard strip, the diamond and the pitch
 * pad showing the current projection. Capture arrives in BSB-3B to BSB-3D.
 */
export default function BaseballGameTracker() {
  const { state } = useGame()
  if (!isBaseballEventPreviewAvailable()) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5">
        <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">
          Baseball event tracking is not available in this build yet.
        </p>
      </main>
    )
  }
  const sport = baseballSportState(state)
  if (!sport) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          This Baseball game could not be read. It is kept as it was saved; start a new game to continue.
        </p>
        <Link to="/sport/baseball" className="btn-secondary inline-block">Back to Baseball</Link>
      </main>
    )
  }
  return <BaseballTracker sport={sport} />
}

function BaseballTracker({ sport }: { sport: BaseballSportGameState }) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pitchLocation, setPitchLocation] = useState<BaseballPitchLocation | null>(null)
  const { setup, projection, capturePreferences } = sport

  const names = {
    tracked: state.gameInfo?.teamName || 'Tracked team',
    opponent: setup.opponentName || 'Opponent',
  }
  const sideName = (side: 'tracked' | 'opponent') => names[side]
  const diamond = baseballDiamondView(sport)
  const inProgress = projection.status === 'in_progress'

  const start = () => {
    const result = startBaseballGame(state, { recorderUserId: user?.id ?? null, occurredAt: new Date().toISOString() })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const setPreference = (patch: Parameters<typeof setBaseballCapturePreferences>[1]) =>
    dispatch({ type: 'HYDRATE_STATE', state: setBaseballCapturePreferences(state, patch) })

  const profile = findBaseballRulesProfile(setup.rulesSnapshot.profileId)

  return (
    <main className="max-w-2xl mx-auto px-4 pb-6 space-y-3">
      <BaseballScoreboard
        view={baseballScoreboardView(sport, names)}
        lineScore={baseballLineScoreView(sport, names)}
        leading={(
          <Link to="/sport/baseball" className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Back to Baseball" title="Back to Baseball">
            <ChevronLeft size={22} />
          </Link>
        )}
        trailing={(
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-sm font-semibold text-content"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
          >
            <Menu size={18} aria-hidden="true" /> Game
          </button>
        )}
      />

      <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
        Development preview. Pitch and play capture comes next. This game stays on this device.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      {projection.status === 'pregame' && (
        <section className="space-y-3">
          <p className="text-sm text-content-muted">
            {profile?.label ?? 'Custom rules'} · {setup.rulesSnapshot.scheduledInnings} innings ·{' '}
            {BATTING_FORMAT_LABELS[setup.rulesSnapshot.battingOrderFormat]}
          </p>
          <button type="button" className="btn-primary w-full" onClick={start}>Start game</button>
          <LineupReview setup={setup} teamName={names.tracked} opponentName={names.opponent} />
        </section>
      )}

      {projection.status !== 'pregame' && (
        <>
          <section aria-label="Diamond">
            <BaseballDiamond
              view={diamond}
              battingLabel={sideName(projection.battingSide)}
              fieldingLabel={sideName(diamond.fieldingSide)}
            />
          </section>
          {inProgress && (
            <BaseballPitchPad
              showZone={capturePreferences.trackPitchLocation}
              pendingLocation={pitchLocation}
              onLocation={setPitchLocation}
              disabledReason="Recording pitches arrives in the next update."
            />
          )}
        </>
      )}

      {menuOpen && (
        <GameMenu onClose={() => setMenuOpen(false)}>
          <Toggle
            label="Track pitch location"
            checked={capturePreferences.trackPitchLocation}
            onChange={checked => setPreference({ trackPitchLocation: checked })}
          />
          <Toggle
            label="Track batted-ball location"
            checked={capturePreferences.trackBattedBallLocation}
            onChange={checked => setPreference({ trackBattedBallLocation: checked })}
          />
        </GameMenu>
      )}
    </main>
  )
}

function GameMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <h2 id={titleId} className="flex-1 font-bold text-content">Game</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close" autoFocus>
            <X size={20} />
          </button>
        </header>
        <div className="space-y-2 p-4">{children}</div>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line px-3">
      <span className="text-sm font-semibold text-content">{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="h-5 w-5 accent-[rgb(var(--accent))]"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  )
}

function LineupReview({ setup, teamName, opponentName }: { setup: BaseballMatchSetup; teamName: string; opponentName: string }) {
  const participant = new Map(setup.participants.map(entry => [entry.id, entry]))
  const fieldingNumber = new Map(Object.entries(setup.trackedLineup.defense).map(([key, id]) => [id, Number(key)]))
  const name = (id: string) => {
    const entry = participant.get(id)
    return entry ? `${entry.number ? `#${entry.number} ` : ''}${entry.displayName}` : 'Unknown player'
  }
  const bench = setup.participants.filter(entry =>
    !setup.trackedLineup.battingOrder.includes(entry.id) && !fieldingNumber.has(entry.id))

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section>
        <h2 className="text-sm font-bold uppercase text-content-muted">{teamName}</h2>
        <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">
          {setup.trackedLineup.battingOrder.map(id => {
            const number = fieldingNumber.get(id)
            return (
              <li key={id}>
                {name(id)}
                <span className="text-content-muted"> · {number ? baseballFieldingPositionCode(number) : 'Bats only'}</span>
              </li>
            )
          })}
        </ol>
        {Object.entries(setup.trackedLineup.defense)
          .filter(([, id]) => !setup.trackedLineup.battingOrder.includes(id))
          .map(([key, id]) => (
            <p key={key} className="mt-1 text-sm">
              {baseballFieldingPositionCode(Number(key))}: {name(id)} <span className="text-content-muted">(does not bat)</span>
            </p>
          ))}
        {bench.length > 0 && (
          <p className="mt-2 text-sm text-content-muted">Bench: {bench.map(entry => name(entry.id)).join(', ')}</p>
        )}
      </section>
      <section>
        <h2 className="text-sm font-bold uppercase text-content-muted">{opponentName}</h2>
        <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">
          {setup.opponentSlots.map((slot, index) => (
            <li key={slot.id}>
              {[slot.number ? `#${slot.number}` : null, slot.label ?? `Batter ${index + 1}`].filter(Boolean).join(' ')}
              {slot.position && <span className="text-content-muted"> · {slot.position}</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm">
          Pitcher: {[setup.opponentPitcher.number ? `#${setup.opponentPitcher.number}` : null, setup.opponentPitcher.label ?? 'Starting pitcher']
            .filter(Boolean).join(' ')}
        </p>
      </section>
    </div>
  )
}
