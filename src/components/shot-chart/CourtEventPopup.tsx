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
export const COURT_STAT_EVENTS = [
  { statId: 'oreb', label: 'Off Reb' },
  { statId: 'dreb', label: 'Def Reb' },
  { statId: 'stl', label: 'Steal' },
  { statId: 'blk', label: 'Block' },
  { statId: 'ast', label: 'Assist' },
] as const

export type CourtStatEventId = (typeof COURT_STAT_EVENTS)[number]['statId']

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
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 border border-slate-200'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onPointerDownCapture={handlePointerDownCapture}
      onClick={cancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <button
            type="button"
            onClick={togglePlayerPicker}
            disabled={isFollowUpStep}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                       text-left active:bg-slate-100 active:scale-[0.99] transition-transform
                       disabled:cursor-default disabled:opacity-90"
            aria-expanded={pickerOpen}
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Log for
              </span>
              <span className="block text-base font-bold text-slate-800 truncate">{playerLabel}</span>
              {playerStatLine && (
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
                  {playerStatLine}
                </span>
              )}
            </span>
            <span className="text-slate-400 text-sm" aria-hidden>
              {pickerOpen ? '^' : 'v'}
            </span>
          </button>
          {pickerOpen && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2">
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
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
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
            <span className="text-xs font-semibold text-slate-500">Shot value</span>
            <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
              {(['2pt', '3pt'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseShotType(value)}
                  disabled={isFollowUpStep}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                    selectedShotType === value
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 active:text-slate-800'
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
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-sm font-bold text-emerald-900">Assisted by?</p>
              <p className="text-xs text-emerald-700">Optional. The shooter stays active.</p>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {assistCandidates.map(player => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => finishMadeShot(player.id)}
                  title={player.name}
                  className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2
                             text-sm font-semibold text-slate-700 active:bg-slate-100 active:scale-95
                             transition-transform"
                >
                  {playerPickerLabel(player)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => finishMadeShot()}
              className="w-full py-3 rounded-xl text-sm font-bold text-slate-700 bg-slate-100
                         border border-slate-200 active:bg-slate-200 active:scale-95
                         transition-transform"
            >
              No assist
            </button>
          </div>
        ) : pendingMissedShotType ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-sm font-bold text-rose-900">Rebound?</p>
              <p className="text-xs text-rose-700">Optional. The missed shot stays with {playerLabel}.</p>
            </div>

            {missReboundOptions && (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Offensive rebound
                    </p>
                    <button
                      type="button"
                      disabled={!offensiveReboundPlayerId}
                      onClick={() => {
                        if (!offensiveReboundPlayerId) return
                        finishMissedShot({ statId: 'oreb', playerId: offensiveReboundPlayerId })
                      }}
                      className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white
                                 disabled:opacity-40 disabled:pointer-events-none active:bg-sky-700
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

                <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Defensive rebound
                    </p>
                    <button
                      type="button"
                      disabled={!defensiveReboundPlayerId}
                      onClick={() => {
                        if (!defensiveReboundPlayerId) return
                        finishMissedShot({ statId: 'dreb', playerId: defensiveReboundPlayerId })
                      }}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white
                                 disabled:opacity-40 disabled:pointer-events-none active:bg-indigo-700
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
              className="w-full py-3 rounded-xl text-sm font-bold text-slate-700 bg-slate-100
                         border border-slate-200 active:bg-slate-200 active:scale-95
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
                className="py-4 rounded-xl text-base font-bold text-white bg-emerald-600
                           active:bg-emerald-700 active:scale-95 transition-transform"
              >
                Made
              </button>
              <button
                type="button"
                onClick={continueMissedShot}
                className="py-4 rounded-xl text-base font-bold text-white bg-rose-600
                           active:bg-rose-700 active:scale-95 transition-transform"
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
                  className="py-3 px-1 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100
                             border border-slate-200 active:bg-slate-200 active:scale-95 transition-transform"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Shots save the tapped court location. The other events only add the stat — same as
              tapping its button below the court.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={cancel}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-300
                     active:scale-95 transition-transform"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
