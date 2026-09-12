import { useEffect, useRef, useState } from 'react'
import type { Player } from '../../types'
import { assistCandidatesForMadeShot } from '../../lib/assistCandidates'
import {
  reboundPromptOptionsForMiss,
  type ReboundPromptOptions,
  type ReboundStatId,
} from '../../lib/reboundPrompt'
import { isTeamPseudoPlayer, sortTeamPlayersFirst } from '../../lib/teamPlayers'

/**
 * Presses within this window after opening are ignored. Combined with the
 * pointer-down arming check below, this stops the court tap that opened the
 * popup from also activating whichever button renders under the finger.
 */
const ARMING_DELAY_MS = 300

/** Stat-only events the popup can record (no court location stored). */
const COURT_STAT_EVENTS = [
  { statId: 'oreb', label: 'Off Reb' },
  { statId: 'dreb', label: 'Def Reb' },
  { statId: 'stl', label: 'Steal' },
  { statId: 'blk', label: 'Block' },
  { statId: 'ast', label: 'Assist' },
] as const

type CourtStatEventId = (typeof COURT_STAT_EVENTS)[number]['statId']

function playerPickerLabel(player: Player): string {
  if (isTeamPseudoPlayer(player)) return `${player.number || '*'} ${player.name}`
  return `#${player.number || '?'} ${player.name.split(' ')[0]}`
}

/** Choice made in the popup: a located shot, or a stat-only increment. */
export interface CourtReboundChoice {
  statId: ReboundStatId
  playerId: string
}

export type CourtEvent =
  | {
      kind: 'shot'
      made: boolean
      shotType: '2pt' | '3pt'
      assistPlayerId?: string
      rebound?: CourtReboundChoice
    }
  | { kind: 'stat'; statId: CourtStatEventId }

interface CourtEventPopupProps {
  /** Display label for the player the event will be attributed to (e.g. "#23 Jordan"). */
  playerLabel: string
  /** Compact display-only live stat context for the selected player. */
  playerStatLine?: string
  players: Player[]
  activePlayerId: string
  onSelectPlayer: (playerId: string) => void
  reboundPromptAfterMissEnabled?: boolean
  /** Detected from the tap location via `isThreePointer`; user can override before logging. */
  shotType: '2pt' | '3pt'
  onShotTypeChange?: (shotType: '2pt' | '3pt') => void
  errorMessage?: string | null
  onPick: (event: CourtEvent) => void
  /** Cancel button, tap-outside, and Escape all dismiss with no change (D8). */
  onCancel: () => void
}

/**
 * Court Event Capture popup (F1 Option A): opened by a confirmed court tap; resolves
 * the event for the currently selected player. Made/Missed store the tapped location
 * (shot marker); the stat-only buttons increment the stat with no location.
 */
export default function CourtEventPopup({
  playerLabel,
  playerStatLine,
  players,
  activePlayerId,
  onSelectPlayer,
  reboundPromptAfterMissEnabled = false,
  shotType,
  onShotTypeChange,
  errorMessage,
  onPick,
  onCancel,
}: CourtEventPopupProps) {
  const [selectedShotType, setSelectedShotType] = useState<'2pt' | '3pt'>(shotType)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingMadeShotType, setPendingMadeShotType] = useState<'2pt' | '3pt' | null>(null)
  const [pendingMissedShotType, setPendingMissedShotType] = useState<'2pt' | '3pt' | null>(null)
  const [missReboundOptions, setMissReboundOptions] = useState<ReboundPromptOptions | null>(null)
  const [offensiveReboundPlayerId, setOffensiveReboundPlayerId] = useState<string | null>(null)
  const [defensiveReboundPlayerId, setDefensiveReboundPlayerId] = useState<string | null>(null)
  const assistCandidates = assistCandidatesForMadeShot(players, activePlayerId)
  const isFollowUpStep = Boolean(pendingMadeShotType || pendingMissedShotType)

  /**
   * Ghost-tap guard: the court tap that opens the popup fires a trailing `click` at the
   * same screen point, which would instantly press whatever button rendered under the
   * finger. A press only counts when its `pointerdown` landed on the popup itself, at
   * least ARMING_DELAY_MS after opening — the opening tap's pointer-down happened before
   * the popup existed, so it can never arm it.
   */
  const openedAtRef = useRef(Date.now())
  const armedRef = useRef(false)

  useEffect(() => {
    setSelectedShotType(shotType)
  }, [shotType])

  const handlePointerDownCapture = () => {
    if (Date.now() - openedAtRef.current >= ARMING_DELAY_MS) {
      armedRef.current = true
    }
  }

  const pick = (event: CourtEvent) => {
    if (!armedRef.current) return
    armedRef.current = false
    onPick(event)
  }

  const continueMadeShot = () => {
    if (!armedRef.current) return
    if (assistCandidates.length === 0) {
      pick({ kind: 'shot', made: true, shotType: selectedShotType })
      return
    }
    armedRef.current = false
    setPickerOpen(false)
    setPendingMadeShotType(selectedShotType)
  }

  const finishMadeShot = (assistPlayerId?: string) => {
    if (!pendingMadeShotType) return
    pick({ kind: 'shot', made: true, shotType: pendingMadeShotType, assistPlayerId })
  }

  const continueMissedShot = () => {
    if (!armedRef.current) return
    if (!reboundPromptAfterMissEnabled) {
      pick({ kind: 'shot', made: false, shotType: selectedShotType })
      return
    }

    const reboundOptions = reboundPromptOptionsForMiss(players, activePlayerId)
    if (!reboundOptions) {
      pick({ kind: 'shot', made: false, shotType: selectedShotType })
      return
    }

    armedRef.current = false
    setPickerOpen(false)
    setPendingMissedShotType(selectedShotType)
    setMissReboundOptions(reboundOptions)
    setOffensiveReboundPlayerId(reboundOptions.defaultOffensivePlayerId)
    setDefensiveReboundPlayerId(reboundOptions.defaultDefensivePlayerId)
  }

  const selectReboundPlayer = (statId: ReboundStatId, playerId: string) => {
    if (!armedRef.current) return
    if (!pendingMissedShotType) return
    if (statId === 'oreb') {
      setOffensiveReboundPlayerId(playerId)
    } else {
      setDefensiveReboundPlayerId(playerId)
    }
  }

  const finishMissedShot = (rebound?: CourtReboundChoice) => {
    if (!pendingMissedShotType) return
    pick({ kind: 'shot', made: false, shotType: pendingMissedShotType, rebound })
  }

  const cancel = () => {
    if (!armedRef.current) return
    armedRef.current = false
    onCancel()
  }

  const chooseShotType = (nextShotType: '2pt' | '3pt') => {
    if (!armedRef.current) return
    if (isFollowUpStep) return
    setSelectedShotType(nextShotType)
    onShotTypeChange?.(nextShotType)
  }

  const togglePlayerPicker = () => {
    if (!armedRef.current) return
    if (isFollowUpStep) return
    setPickerOpen(open => !open)
  }

  const selectPlayer = (playerId: string) => {
    if (!armedRef.current) return
    if (isFollowUpStep) return
    onSelectPlayer(playerId)
    setPickerOpen(false)
  }

  const reboundCandidateButtons = (
    statId: ReboundStatId,
    candidates: Player[],
    selectedPlayerId: string | null
  ) => (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {candidates.map(player => {
        const active = player.id === selectedPlayerId
        return (
          <button
            key={player.id}
            type="button"
            onClick={() => selectReboundPlayer(statId, player.id)}
            title={player.name}
            className={`flex-shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-left active:scale-95 transition-transform ${
              active
                ? 'bg-accent text-accent-content shadow-sm'
                : 'bg-control text-content border border-line'
            }`}
          >
            {playerPickerLabel(player)}
          </button>
        )
      })}
    </div>
  )

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/[0.4] px-4"
      onPointerDownCapture={handlePointerDownCapture}
      onClick={cancel}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl max-w-sm w-full p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        {errorMessage && (
          <p role="alert" className="rounded-xl border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
            {errorMessage}
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={togglePlayerPicker}
            disabled={isFollowUpStep}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-muted px-3 py-2
                       text-left active:bg-control active:scale-[0.99] transition-transform
                       disabled:cursor-default disabled:bg-control-disabled disabled:text-content-disabled"
            aria-expanded={pickerOpen}
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Log for
              </span>
              <span className="block text-base font-bold text-content truncate">{playerLabel}</span>
              {playerStatLine && (
                <span className="mt-0.5 block truncate text-xs font-semibold text-content-subtle">
                  {playerStatLine}
                </span>
              )}
            </span>
            <span className="text-content-subtle text-sm" aria-hidden>
              {pickerOpen ? '^' : 'v'}
            </span>
          </button>
          {pickerOpen && (
            <div className="mt-2 rounded-xl border border-line bg-surface p-2">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {sortTeamPlayersFirst(players).map(player => {
                  const active = player.id === activePlayerId
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => selectPlayer(player.id)}
                      title={player.name}
                      className={`flex-shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-left active:scale-95 transition-transform ${
                        active
                          ? 'bg-accent text-accent-content shadow-sm'
                          : 'bg-control text-content border border-line'
                      }`}
                    >
                      {playerPickerLabel(player)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-content-subtle">Shot value</span>
            <div className="grid grid-cols-2 rounded-xl border border-line bg-control p-1">
              {(['2pt', '3pt'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseShotType(value)}
                  disabled={isFollowUpStep}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-transform ${
                    selectedShotType === value
                      ? 'bg-surface text-content shadow-sm'
                      : 'text-content-subtle active:text-content'
                  }`}
                  aria-pressed={selectedShotType === value}
                >
                  {value === '3pt' ? '3PT' : '2PT'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {pendingMadeShotType ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-success-line bg-success px-3 py-2">
              <p className="text-sm font-bold text-success-content">Assisted by?</p>
              <p className="text-xs text-success-content">Optional. The shooter stays active.</p>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {assistCandidates.map(player => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => finishMadeShot(player.id)}
                  title={player.name}
                  className="flex-shrink-0 rounded-lg border border-line bg-surface px-3 py-2
                             text-sm font-semibold text-content active:bg-control active:scale-95
                             transition-transform"
                >
                  {playerPickerLabel(player)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => finishMadeShot()}
              className="w-full py-3 rounded-xl text-sm font-bold text-content bg-control
                         border border-line active:bg-control active:scale-95
                         transition-transform"
            >
              No assist
            </button>
          </div>
        ) : pendingMissedShotType ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-danger-line bg-danger px-3 py-2">
              <p className="text-sm font-bold text-danger-content">Rebound?</p>
              <p className="text-xs text-danger-content">Optional. The missed shot stays with {playerLabel}.</p>
            </div>

            {missReboundOptions && (
              <div className="space-y-3">
                <div className="rounded-xl border border-line bg-surface p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-content-subtle">
                      Offensive rebound
                    </p>
                    <button
                      type="button"
                      disabled={!offensiveReboundPlayerId}
                      onClick={() => {
                        if (!offensiveReboundPlayerId) return
                        finishMissedShot({ statId: 'oreb', playerId: offensiveReboundPlayerId })
                      }}
                      className="rounded-lg bg-info px-3 py-2 text-sm font-bold text-content
                                 disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:bg-info
                                 active:scale-95 transition-transform"
                    >
                      Off Reb
                    </button>
                  </div>
                  {reboundCandidateButtons(
                    'oreb',
                    missReboundOptions.offensiveCandidates,
                    offensiveReboundPlayerId
                  )}
                </div>

                <div className="rounded-xl border border-line bg-surface p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-content-subtle">
                      Defensive rebound
                    </p>
                    <button
                      type="button"
                      disabled={!defensiveReboundPlayerId}
                      onClick={() => {
                        if (!defensiveReboundPlayerId) return
                        finishMissedShot({ statId: 'dreb', playerId: defensiveReboundPlayerId })
                      }}
                      className="rounded-lg bg-info px-3 py-2 text-sm font-bold text-content
                                 disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:bg-info
                                 active:scale-95 transition-transform"
                    >
                      Def Reb
                    </button>
                  </div>
                  {reboundCandidateButtons(
                    'dreb',
                    missReboundOptions.defensiveCandidates,
                    defensiveReboundPlayerId
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => finishMissedShot()}
              className="w-full py-3 rounded-xl text-sm font-bold text-content bg-control
                         border border-line active:bg-control active:scale-95
                         transition-transform"
            >
              No rebound
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={continueMadeShot}
                className="py-4 rounded-xl text-base font-bold text-success-content bg-success
                           active:bg-success active:scale-95 transition-transform"
              >
                Made
              </button>
              <button
                type="button"
                onClick={continueMissedShot}
                className="py-4 rounded-xl text-base font-bold text-danger-content bg-danger
                           active:bg-danger active:scale-95 transition-transform"
              >
                Missed
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {COURT_STAT_EVENTS.map(({ statId, label }) => (
                <button
                  key={statId}
                  type="button"
                  onClick={() => pick({ kind: 'stat', statId })}
                  className="py-3 px-1 rounded-xl text-sm font-semibold text-content bg-control
                             border border-line active:bg-control active:scale-95 transition-transform"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-content-subtle leading-snug">
              Shots save the tapped court location. The other events only add the stat — same as
              tapping its button below the court.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={cancel}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-content-muted border border-line-strong
                     active:scale-95 transition-transform"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
