import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Pause, Play, Settings2, Users } from 'lucide-react'
import type { GameState } from '../../types'
import type { BasketballDeviceSettings } from '../../lib/settingsStorage'
import {
  pauseBasketballClock,
  setBasketballClock,
  startBasketballClock,
} from '../../lib/basketball/clockCommands'
import {
  basketballClockRecoveryIssue,
  deriveBasketballClockDisplay,
} from '../../lib/basketball/clockProjection'
import {
  confirmBasketballBoundaryLineup,
  updateBasketballLineup,
} from '../../lib/basketball/lineupCommands'
import { isBasketballMatchRulesV3, resolveBasketballPeriodSegment } from '../../lib/basketball/rules'
import type { BasketballStoppageCategory, BasketballTeamSide } from '../../lib/basketball/types'
import BasketballLineupSheet, { type BasketballLineupSheetCommit } from './BasketballLineupSheet'
import BasketballBoundaryReviewDialog, {
  type BasketballBoundaryReviewCommit,
} from './BasketballBoundaryReviewDialog'

const STOPPAGE_OPTIONS: Array<{ value: BasketballStoppageCategory; label: string }> = [
  { value: 'timeout', label: 'Timeout' },
  { value: 'foul_free_throw', label: 'Foul / free throw' },
  { value: 'out_of_bounds', label: 'Out of bounds' },
  { value: 'substitution', label: 'Substitution' },
  { value: 'injury', label: 'Injury' },
  { value: 'official_review', label: 'Official review' },
  { value: 'other', label: 'Other' },
]

export default function BasketballClockStrip({
  state,
  recorderUserId,
  settings,
  canOverrideEqualPlay,
  requestedLineupSide = null,
  onRequestedLineupOpened,
  onAddParticipant,
  onState,
}: {
  state: GameState
  recorderUserId: string | null
  settings: BasketballDeviceSettings
  canOverrideEqualPlay: boolean
  requestedLineupSide?: BasketballTeamSide | null
  onRequestedLineupOpened?: () => void
  onAddParticipant?: (teamSide: BasketballTeamSide) => void
  onState: (state: GameState) => void
}) {
  const stateRef = useRef(state)
  stateRef.current = state
  const [now, setNow] = useState(() => new Date().toISOString())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showSetClock, setShowSetClock] = useState(false)
  const [showStoppage, setShowStoppage] = useState(false)
  const [clockValue, setClockValue] = useState('')
  const [clockReason, setClockReason] = useState('')
  const [stoppageCategory, setStoppageCategory] = useState<BasketballStoppageCategory>('timeout')
  const [stoppageNote, setStoppageNote] = useState('')
  const [lineupSide, setLineupSide] = useState<BasketballTeamSide | null>(null)
  const [lineupError, setLineupError] = useState<string | null>(null)
  const [boundaryReviewOpen, setBoundaryReviewOpen] = useState(false)
  const lineupButtonRef = useRef<HTMLButtonElement>(null)
  const expirationAnnouncementRef = useRef<string | null>(null)

  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  const rules = sportState?.setup.rulesSnapshot
  const clock = sportState?.projection.clock
  const anchored = Boolean(rules && isBasketballMatchRulesV3(rules) && rules.clockModel === 'anchored')
  const segment = rules && clock?.periodId
    ? resolveBasketballPeriodSegment(rules, clock.periodId)
    : null
  const display = clock && segment && rules && isBasketballMatchRulesV3(rules)
    ? deriveBasketballClockDisplay(clock, segment.durationMs, rules.clockDisplayDirection, now)
    : null
  const recoveryIssue = clock?.running
    ? basketballClockRecoveryIssue(clock, now)
    : null

  useEffect(() => {
    if (!clock?.running) return
    const interval = window.setInterval(() => setNow(new Date().toISOString()), 100)
    return () => window.clearInterval(interval)
  }, [clock?.running, clock?.lastStartEventId])

  const applyResult = useCallback((result: ReturnType<typeof pauseBasketballClock>) => {
    if (!result.ok) {
      setError(result.message)
      return false
    }
    stateRef.current = result.state
    setError(null)
    onState(result.state)
    return true
  }, [onState])

  const announceExpiration = useCallback((periodId: string) => {
    if (expirationAnnouncementRef.current === periodId) return
    expirationAnnouncementRef.current = periodId
    setNotice('Period clock expired and paused at zero.')
    if (settings.clockExpirationVibrationEnabled && 'vibrate' in navigator) {
      try { navigator.vibrate(180) } catch { /* Presentation-only failure. */ }
    }
    if (settings.clockExpirationSoundEnabled) {
      try {
        const AudioContextCtor = window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioContextCtor) {
          const context = new AudioContextCtor()
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.frequency.value = 880
          gain.gain.value = 0.08
          oscillator.connect(gain)
          gain.connect(context.destination)
          oscillator.start()
          oscillator.stop(context.currentTime + 0.16)
          oscillator.addEventListener('ended', () => { void context.close() })
        }
      } catch { /* Presentation-only failure. */ }
    }
  }, [settings.clockExpirationSoundEnabled, settings.clockExpirationVibrationEnabled])

  const reconcileClock = useCallback(() => {
    const current = stateRef.current
    const currentSport = current.sportGameState?.sportId === 'basketball'
      ? current.sportGameState
      : null
    const currentClock = currentSport?.projection.clock
    const currentRules = currentSport?.setup.rulesSnapshot
    if (!currentClock?.running || !currentRules || !currentClock.periodId) return
    const occurredAt = new Date().toISOString()
    const unsafe = basketballClockRecoveryIssue(currentClock, occurredAt)
    if (unsafe) {
      setNow(occurredAt)
      setError(unsafe === 'backward'
        ? 'Device time moved backward. Use Set Clock with a reason before recording more events.'
        : 'The clock was away too long to recover automatically. Use Set Clock with a reason.')
      return
    }
    const currentSegment = resolveBasketballPeriodSegment(currentRules, currentClock.periodId)
    if (!currentSegment) return
    const currentDisplay = deriveBasketballClockDisplay(
      currentClock,
      currentSegment.durationMs,
      isBasketballMatchRulesV3(currentRules) ? currentRules.clockDisplayDirection : 'count_up',
      occurredAt
    )
    if (!currentDisplay?.reachedExpiration) return
    const result = pauseBasketballClock(current, { recorderUserId, occurredAt })
    if (applyResult(result)) announceExpiration(currentClock.periodId)
  }, [announceExpiration, applyResult, recorderUserId])

  useEffect(() => {
    if (!clock?.running || !segment || clock.anchorElapsedMs === null || !clock.anchorOccurredAt) return
    const remainingMs = segment.durationMs - clock.anchorElapsedMs
    const boundaryMs = Date.parse(clock.anchorOccurredAt) + remainingMs
    const delay = Math.max(0, Math.min(2_147_000_000, boundaryMs - Date.now()))
    const timeout = window.setTimeout(reconcileClock, delay)
    return () => window.clearTimeout(timeout)
  }, [clock?.anchorElapsedMs, clock?.anchorOccurredAt, clock?.running, reconcileClock, segment])

  useEffect(() => {
    const onReturn = () => reconcileClock()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconcileClock()
    }
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onVisibility)
    reconcileClock()
    return () => {
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reconcileClock])

  const lineupSides = sportState?.projection.lineup?.sides
  const currentFive = useMemo(() => {
    if (!lineupSides || !sportState) return []
    return (['tracked', 'opponent'] as BasketballTeamSide[]).flatMap(side => {
      const sideProjection = lineupSides[side]
      if (!sideProjection) return []
      return sideProjection.currentParticipantIds.map(participantId => {
        const participant = sportState.projection.participants[participantId]
        return {
          id: `${side}:${participantId}`,
          side,
          label: participant
            ? `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
            : 'Unknown player',
        }
      })
    })
  }, [lineupSides, sportState])
  const pendingSides = (['tracked', 'opponent'] as BasketballTeamSide[]).filter(
    side => lineupSides?.[side]?.boundaryConfirmationRequired
  )

  useEffect(() => {
    if (!requestedLineupSide || !clock || clock.running || recoveryIssue) return
    if (!lineupSides?.[requestedLineupSide]) return
    setShowSetClock(false)
    setShowStoppage(false)
    setLineupError(null)
    setLineupSide(requestedLineupSide)
    onRequestedLineupOpened?.()
  }, [clock, lineupSides, onRequestedLineupOpened, recoveryIssue, requestedLineupSide])

  if (!anchored || !clock || !segment || !display || !rules || !isBasketballMatchRulesV3(rules)) {
    return null
  }

  const commitClock = (next: GameState) => {
    stateRef.current = next
    setNow(new Date().toISOString())
    setError(null)
    onState(next)
  }

  const handleStart = () => {
    if (pendingSides.length > 0) {
      setBoundaryReviewOpen(true)
      setLineupError(null)
      setError(null)
      return
    }
    const result = startBasketballClock(stateRef.current, {
      recorderUserId,
      occurredAt: new Date().toISOString(),
    })
    if (!result.ok) return setError(result.message)
    setNotice(null)
    commitClock(result.state)
  }

  const handlePause = () => {
    const result = pauseBasketballClock(stateRef.current, {
      recorderUserId,
      occurredAt: new Date().toISOString(),
    })
    if (!result.ok) return setError(result.message)
    commitClock(result.state)
  }

  const openSetClock = () => {
    setClockValue(formatClockInput(display.displayMs))
    setClockReason('')
    setShowSetClock(true)
    setShowStoppage(false)
  }

  const handleSetClock = () => {
    const displayMs = parseClockInput(clockValue)
    if (displayMs === null || displayMs > segment.durationMs) {
      setError('Enter a clock value from 0:00 through the period duration.')
      return
    }
    const elapsedMs = rules.clockDisplayDirection === 'count_down'
      ? segment.durationMs - displayMs
      : displayMs
    const wasRecovery = basketballClockRecoveryIssue(clock, new Date().toISOString()) !== null
    const result = setBasketballClock(stateRef.current, {
      recorderUserId,
      occurredAt: new Date().toISOString(),
      elapsedMs,
      reason: clockReason,
    })
    if (!result.ok) return setError(result.message)
    setShowSetClock(false)
    setNotice(wasRecovery ? 'Clock recovered at the last-known safe event time.' : 'Clock updated and paused.')
    commitClock(result.state)
  }

  const handleStoppage = () => {
    const result = pauseBasketballClock(stateRef.current, {
      recorderUserId,
      occurredAt: new Date().toISOString(),
      stoppage: { category: stoppageCategory, note: stoppageNote },
    })
    if (!result.ok) return setError(result.message)
    setShowStoppage(false)
    setStoppageNote('')
    commitClock(result.state)
  }

  const closeLineup = () => {
    setLineupSide(null)
    setLineupError(null)
    window.requestAnimationFrame(() => lineupButtonRef.current?.focus())
  }

  const openLineup = () => {
    if (clock.running || recoveryIssue) return
    setShowSetClock(false)
    setShowStoppage(false)
    setLineupError(null)
    setLineupSide('tracked')
  }

  const handleLineupCommit = (input: BasketballLineupSheetCommit) => {
    const result = updateBasketballLineup(stateRef.current, {
      recorderUserId,
      teamSide: input.teamSide,
      participantIds: input.participantIds,
      mode: input.mode,
      reasonCode: input.reasonCode,
      reasonNote: input.reasonNote,
      roleChanges: input.roleChanges,
      occurredAt: new Date().toISOString(),
    })
    if (!result.ok) {
      setLineupError(result.message)
      return
    }
    const sideLabel = input.teamSide === 'tracked' ? 'Tracked' : 'Opponent'
    setLineupSide(null)
    setLineupError(null)
    setNotice(`${sideLabel} lineup updated.`)
    commitClock(result.state)
    window.requestAnimationFrame(() => lineupButtonRef.current?.focus())
  }

  const handleBoundaryCommit = (input: BasketballBoundaryReviewCommit) => {
    const result = confirmBasketballBoundaryLineup(stateRef.current, {
      recorderUserId,
      teamSide: input.teamSide,
      participantIds: input.participantIds,
      expectedCurrentParticipantIds: input.expectedCurrentParticipantIds,
      reasonCode: input.reasonCode,
      reasonNote: input.reasonNote,
      overrideReason: input.overrideReason ?? undefined,
      overrideAuthorized: canOverrideEqualPlay,
      occurredAt: new Date().toISOString(),
    })
    if (!result.ok) {
      setLineupError(result.message)
      return
    }
    const remaining = (['tracked', 'opponent'] as BasketballTeamSide[]).filter(
      side => result.state.sportGameState?.sportId === 'basketball' &&
        result.state.sportGameState.projection.lineup?.sides[side]?.boundaryConfirmationRequired
    )
    setLineupError(null)
    setNotice(remaining.length > 0
      ? 'Lineup confirmed. Review the remaining side.'
      : 'Lineups confirmed. The clock is ready to start.')
    setBoundaryReviewOpen(remaining.length > 0)
    commitClock(result.state)
  }

  const showTenths = settings.showClockTenths && display.displayMs < 60_000
  const unsafeMessage = recoveryIssue === 'backward'
    ? 'Device time moved backward. Set the clock before recording more events.'
    : recoveryIssue === 'excessive_delta'
      ? 'The clock was away too long to recover automatically. Set the clock before recording more events.'
      : null
  const lineupDisabledReason = clock.running
    ? 'Pause the clock before changing the lineup.'
    : unsafeMessage
      ? 'Set the clock before changing the lineup.'
      : null

  return (
    <>
      <section className="sticky top-0 z-30 border-y border-slate-300 bg-white/95 shadow-sm backdrop-blur" aria-label="Basketball game clock">
        <div className="mx-auto w-full max-w-lg px-3 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Clock3 size={14} aria-hidden />
              <span className="truncate">{segment.label}</span>
              <span>{clock.running ? 'Running' : clock.expired ? 'Expired' : 'Paused'}</span>
            </div>
            <p className="mt-0.5 tabular-nums text-3xl font-bold text-slate-950" aria-live="off">
              {formatClockDisplay(display.displayMs, showTenths)}
            </p>
          </div>
          <button
            type="button"
            onClick={clock.running ? handlePause : handleStart}
            disabled={Boolean(unsafeMessage)}
            className="flex h-14 min-w-28 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-base font-bold text-white disabled:bg-slate-300"
          >
            {clock.running ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
            {clock.running ? 'Pause' : 'Start'}
          </button>
        </div>

        {currentFive.length > 0 && (
          <div className="mt-2 flex min-h-8 items-center gap-1 overflow-x-auto" aria-label="Current lineup">
            <Users size={15} className="mr-1 shrink-0 text-slate-500" aria-hidden />
            {currentFive.map(player => (
              <span
                key={player.id}
                className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${
                  player.side === 'tracked'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
                }`}
              >
                {player.label}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 grid grid-cols-3 gap-2">
          <button type="button" className="btn-secondary min-h-10 text-xs" onClick={openSetClock}>
            <Settings2 size={15} aria-hidden /> Set Clock
          </button>
          <button
            type="button"
            className="btn-secondary min-h-10 text-xs"
            disabled={!clock.running || Boolean(unsafeMessage)}
            onClick={() => { setShowStoppage(value => !value); setShowSetClock(false) }}
          >
            Stoppage
          </button>
          <button
            ref={lineupButtonRef}
            type="button"
            className="btn-secondary flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs"
            disabled={Boolean(lineupDisabledReason)}
            title={lineupDisabledReason ?? undefined}
            aria-label={lineupDisabledReason ? `Lineup unavailable. ${lineupDisabledReason}` : 'Lineup'}
            onClick={openLineup}
          >
            <Users size={15} aria-hidden /> Lineup
          </button>
        </div>

        {pendingSides.length > 0 && !clock.running && (
          <button
            type="button"
            className="btn-primary mt-2 w-full"
            onClick={() => { setBoundaryReviewOpen(true); setLineupError(null) }}
          >
            Review lineup
          </button>
        )}

        {showSetClock && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <label className="text-xs font-semibold text-slate-700">
                Clock ({rules.clockDisplayDirection === 'count_down' ? 'remaining' : 'elapsed'})
                <input
                  value={clockValue}
                  onChange={event => setClockValue(event.target.value)}
                  className="input-field mt-1 w-full text-center tabular-nums"
                  inputMode="numeric"
                  placeholder="8:00"
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Reason
                <input
                  value={clockReason}
                  onChange={event => setClockReason(event.target.value)}
                  className="input-field mt-1 w-full"
                  maxLength={240}
                  placeholder="Required"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowSetClock(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleSetClock}>Apply</button>
            </div>
          </div>
        )}

        {showStoppage && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <label className="block text-xs font-semibold text-slate-700">
              Stoppage context
              <select
                value={stoppageCategory}
                onChange={event => setStoppageCategory(event.target.value as BasketballStoppageCategory)}
                className="input-field mt-1 w-full"
              >
                {STOPPAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Note (optional)
              <input value={stoppageNote} onChange={event => setStoppageNote(event.target.value)} className="input-field mt-1 w-full" maxLength={240} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowStoppage(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleStoppage}>Pause + Save</button>
            </div>
          </div>
        )}

        {(unsafeMessage || error) && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{unsafeMessage ?? error}</p>}
        {notice && !unsafeMessage && <p role="status" className="mt-2 text-sm text-emerald-700">{notice}</p>}
        </div>
      </section>
      {lineupSide && (
        <BasketballLineupSheet
          state={state}
          initialSide={lineupSide}
          errorMessage={lineupError}
          onAddParticipant={onAddParticipant ? side => {
            setLineupSide(null)
            setLineupError(null)
            onAddParticipant(side)
          } : undefined}
          onCommit={handleLineupCommit}
          onClose={closeLineup}
        />
      )}
      {boundaryReviewOpen && pendingSides.length > 0 && (
        <BasketballBoundaryReviewDialog
          state={state}
          pendingSides={pendingSides}
          canOverrideEqualPlay={canOverrideEqualPlay}
          errorMessage={lineupError}
          onCommit={handleBoundaryCommit}
          onClose={() => { setBoundaryReviewOpen(false); setLineupError(null) }}
        />
      )}
    </>
  )
}

function parseClockInput(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):([0-5]\d)(?:\.(\d))?$/)
  if (!match) return null
  return (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3] ?? 0) * 100
}

function formatClockInput(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function formatClockDisplay(valueMs: number, tenths: boolean): string {
  const clamped = Math.max(0, valueMs)
  const totalSeconds = Math.floor(clamped / 1000)
  const base = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((clamped % 1000) / 100)}` : base
}
