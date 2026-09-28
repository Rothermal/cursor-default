import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  baseballFieldingPositionCode,
  baseballSportState,
  findBaseballRulesProfile,
  startBaseballGame,
  type BaseballMatchSetup,
} from '../lib/baseball'
import { isBaseballEventPreviewAvailable } from '../lib/sportAvailability'

const BATTING_FORMAT_LABELS: Record<string, string> = {
  standard: 'Standard (nine bat)',
  designated_hitter: 'Designated hitter',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous order',
}

/**
 * BSB-2 development holding page for Baseball event games: shows the frozen setup and
 * lets the recorder start the game. The live diamond and pitch capture arrive in BSB-3.
 */
export default function BaseballEventGame() {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
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
  const { setup, projection } = sport

  const start = () => {
    const result = startBaseballGame(state, { recorderUserId: user?.id ?? null, occurredAt: new Date().toISOString() })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const teamName = state.gameInfo?.teamName ?? 'Tracked team'
  const opponentName = setup.opponentName ?? 'Opponent'
  const [away, home] = setup.trackedSide === 'home' ? [opponentName, teamName] : [teamName, opponentName]
  const profile = findBaseballRulesProfile(setup.rulesSnapshot.profileId)

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{away} at {home}</h1>
        <p className="text-sm text-content-muted">
          {profile?.label ?? 'Custom rules'} · {setup.rulesSnapshot.scheduledInnings} innings ·{' '}
          {BATTING_FORMAT_LABELS[setup.rulesSnapshot.battingOrderFormat]}
        </p>
      </header>
      <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
        Development preview. The setup is frozen; live pitch and play tracking comes next. This game stays on this device.
      </p>

      <section className="rounded-md bg-surface p-4 space-y-1" aria-live="polite">
        {projection.status === 'pregame' ? (
          <p className="text-base font-semibold">Ready to play ball</p>
        ) : (
          <>
            <p className="text-base font-semibold">
              {projection.half === 'top' ? 'Top' : 'Bottom'} {projection.inning} · {projection.outs} out
              {projection.outs === 1 ? '' : 's'}
            </p>
            <p className="text-sm">
              {teamName} {projection.score.tracked}, {opponentName} {projection.score.opponent}
            </p>
            <p className="text-sm text-content-muted">Status: {projection.status.replace('_', ' ')}</p>
          </>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}
      {projection.status === 'pregame' && (
        <button type="button" className="btn-primary w-full" onClick={start}>Start game</button>
      )}

      <LineupReview setup={setup} teamName={teamName} opponentName={opponentName} />
    </main>
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
