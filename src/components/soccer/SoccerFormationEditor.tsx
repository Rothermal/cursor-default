import { AlertTriangle, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '../../hooks/useModalFocus'
import {
  assignSoccerFormationPlayer,
  clearSoccerFormationSlot,
  getSoccerFormationTemplate,
  soccerFormationTemplatesForCount,
  type SoccerFormationSlotDefinition,
  type SoccerFormationSlotId,
  type SoccerFormationTemplateId,
  type SoccerTeamFormationV1,
} from '../../lib/soccer/formation'

export interface SoccerFormationRosterPlayer {
  id: string
  name: string
  number: string | null
}

const PLAYER_COUNTS = [11, 9, 7] as const

export default function SoccerFormationEditor({
  formation,
  playerCount,
  roster,
  rosterReady,
  rosterLoading,
  readOnly,
  onPlayerCountChange,
  onFormationChange,
  onTemplateSelect,
  onRequestClear,
}: {
  formation: SoccerTeamFormationV1 | null
  playerCount: number
  roster: readonly SoccerFormationRosterPlayer[]
  rosterReady: boolean
  rosterLoading: boolean
  readOnly: boolean
  onPlayerCountChange: (count: 7 | 9 | 11) => void
  onFormationChange: (formation: SoccerTeamFormationV1) => void
  onTemplateSelect: (templateId: SoccerFormationTemplateId) => void
  onRequestClear: () => void
}) {
  const [selectedSlotId, setSelectedSlotId] = useState<SoccerFormationSlotId | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const template = formation
    ? getSoccerFormationTemplate(formation.templateId)
    : null
  const templates = soccerFormationTemplatesForCount(playerCount)
  const rosterById = useMemo(
    () => new Map(roster.map(player => [player.id, player])),
    [roster]
  )
  const selectedSlot = template?.slots.find(slot => slot.id === selectedSlotId) ?? null
  const mismatch = Boolean(template && template.playerCount !== playerCount)
  const pickerDisabled = readOnly || !rosterReady

  useEffect(() => {
    if (selectedSlotId && !template?.slots.some(slot => slot.id === selectedSlotId)) {
      setSelectedSlotId(null)
    }
  }, [selectedSlotId, template])

  const assignPlayer = (slot: SoccerFormationSlotDefinition, playerId: string) => {
    if (!formation || pickerDisabled) return
    const previousSlot = template?.slots.find(
      candidate => formation.assignments[candidate.id] === playerId
    )
    const player = rosterById.get(playerId)
    onFormationChange(assignSoccerFormationPlayer(formation, slot.id, playerId))
    setSelectedSlotId(null)
    setAnnouncement(
      previousSlot && previousSlot.id !== slot.id
        ? `${player?.name ?? 'Player'} moved from ${previousSlot.label} to ${slot.label}.`
        : `${player?.name ?? 'Player'} assigned to ${slot.label}.`
    )
  }

  const clearSlot = (slot: SoccerFormationSlotDefinition) => {
    if (!formation || pickerDisabled) return
    onFormationChange(clearSoccerFormationSlot(formation, slot.id))
    setSelectedSlotId(null)
    setAnnouncement(`${slot.label} cleared.`)
  }

  return (
    <div className="space-y-5">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <fieldset disabled={readOnly} className="space-y-2">
        <legend className="text-sm font-semibold text-content">Players on field</legend>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-surface-muted p-1" aria-label="Formation player count">
          {PLAYER_COUNTS.map(count => (
            <button
              key={count}
              type="button"
              onClick={() => onPlayerCountChange(count)}
              className={`h-9 rounded text-sm font-semibold ${
                playerCount === count
                  ? 'bg-surface text-success-content shadow-sm'
                  : 'text-content-muted hover:bg-surface/70'
              }`}
              aria-pressed={playerCount === count}
            >
              {count}v{count}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={readOnly} className="space-y-2">
        <legend className="text-sm font-semibold text-content">Template</legend>
        <div className="grid grid-cols-3 gap-2">
          {templates.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => onTemplateSelect(option.id)}
              className={`h-10 rounded-md border text-sm font-semibold ${
                formation?.templateId === option.id
                  ? 'border-success-line bg-success text-success-content'
                  : 'border-line bg-surface text-content hover:border-success-line'
              }`}
              aria-pressed={formation?.templateId === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {mismatch && template && (
        <div role="alert" className="flex gap-2 rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            {template.label} is a {template.playerCount}-player formation, but team rules currently use {playerCount}.
          </span>
        </div>
      )}

      {!formation || !template ? (
        <div className="border-y border-line py-6 text-center">
          <p className="text-sm font-semibold text-content">No default formation</p>
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-sm">
            <div
              className="relative aspect-[68/100] overflow-hidden rounded-md border-2 border-emerald-800 bg-emerald-600"
              aria-label={`${template.label} formation pitch`}
            >
              <div className="absolute inset-x-0 top-1/2 border-t border-white/80" />
              <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80" />
              <div className="absolute inset-x-[27%] top-0 h-[13%] border-x border-b border-white/80" />
              <div className="absolute inset-x-[27%] bottom-0 h-[13%] border-x border-t border-white/80" />
              {template.slots.map(slot => (
                <FormationSlotButton
                  key={slot.id}
                  slot={slot}
                  player={formation.assignments[slot.id]
                    ? rosterById.get(formation.assignments[slot.id]!) ?? null
                    : null}
                  assignedPlayerId={formation.assignments[slot.id] ?? null}
                  disabled={pickerDisabled}
                  onClick={() => setSelectedSlotId(slot.id)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2" role="list" aria-label="Formation slots">
            {template.slots.map(slot => {
              const assignedPlayerId = formation.assignments[slot.id] ?? null
              const player = assignedPlayerId ? rosterById.get(assignedPlayerId) ?? null : null
              const assignment = assignedPlayerId
                ? player?.name ?? 'Player unavailable'
                : 'Unassigned'
              return (
                <div
                  key={slot.id}
                  role="listitem"
                  className="grid min-h-12 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-2 last:border-b-0"
                >
                  <span className="text-sm font-bold text-success-content">{slot.label}</span>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-semibold ${player || !assignedPlayerId ? 'text-content' : 'text-warning-content'}`}>
                      {assignment}
                    </span>
                    <span className="block text-xs capitalize text-content-muted">{slot.roleGroup}</span>
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setSelectedSlotId(slot.id)}
                      disabled={!rosterReady}
                      className="h-9 rounded-md border border-line px-3 text-sm font-semibold text-content disabled:text-content-disabled"
                      aria-label={`${assignedPlayerId ? 'Change' : 'Choose'} ${slot.label} player`}
                    >
                      {assignedPlayerId ? 'Change' : 'Choose'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={onRequestClear}
              className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-danger-content"
            >
              <Trash2 size={16} />
              Clear Formation
            </button>
          )}
        </>
      )}

      {!rosterReady && (
        <p className="text-sm text-content-muted" role="status">
          {rosterLoading ? 'Loading active roster...' : 'Active roster unavailable.'}
        </p>
      )}

      <RosterPickerDialog
        slot={selectedSlot}
        assignedPlayerId={selectedSlot && formation
          ? formation.assignments[selectedSlot.id] ?? null
          : null}
        roster={roster}
        open={Boolean(selectedSlot && !pickerDisabled)}
        onAssign={playerId => selectedSlot && assignPlayer(selectedSlot, playerId)}
        onClear={() => selectedSlot && clearSlot(selectedSlot)}
        onClose={() => setSelectedSlotId(null)}
      />
    </div>
  )
}

function FormationSlotButton({
  slot,
  player,
  assignedPlayerId,
  disabled,
  onClick,
}: {
  slot: SoccerFormationSlotDefinition
  player: SoccerFormationRosterPlayer | null
  assignedPlayerId: string | null
  disabled: boolean
  onClick: () => void
}) {
  const assignment = assignedPlayerId
    ? player?.name ?? 'Unavailable'
    : 'Open'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`absolute h-11 w-[4.5rem] -translate-x-1/2 -translate-y-1/2 rounded-md border px-1 shadow-sm disabled:cursor-default ${
        assignedPlayerId && !player
          ? 'border-warning-line bg-warning text-warning-content'
          : assignedPlayerId
            ? 'border-white bg-white text-slate-900'
            : 'border-dashed border-white/90 bg-emerald-800/80 text-white'
      }`}
      style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%` }}
      aria-label={`${slot.label}: ${assignedPlayerId ? player?.name ?? 'Player unavailable' : 'Unassigned'}`}
    >
      <span className="block text-[10px] font-bold leading-none">{slot.label}</span>
      <span className="mt-1 block truncate text-[11px] font-semibold leading-none">{assignment}</span>
    </button>
  )
}

function RosterPickerDialog({
  slot,
  assignedPlayerId,
  roster,
  open,
  onAssign,
  onClear,
  onClose,
}: {
  slot: SoccerFormationSlotDefinition | null
  assignedPlayerId: string | null
  roster: readonly SoccerFormationRosterPlayer[]
  open: boolean
  onAssign: (playerId: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useModalFocus({
    enabled: open,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  })

  if (!open || !slot) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/40 p-2 safe-bottom sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-md bg-surface p-4 shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-base font-bold text-content">
            {slot.label} player
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md text-content-muted hover:bg-surface-muted"
            aria-label="Close player picker"
            title="Close"
          >
            <X size={19} />
          </button>
        </div>

        <div className="space-y-1">
          {roster.map(player => (
            <button
              key={player.id}
              type="button"
              onClick={() => onAssign(player.id)}
              className={`grid min-h-12 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-left ${
                assignedPlayerId === player.id
                  ? 'bg-success text-success-content'
                  : 'text-content hover:bg-surface-muted'
              }`}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-muted text-xs font-bold text-content-muted">
                {player.number ?? <UserRound size={16} />}
              </span>
              <span className="truncate text-sm font-semibold">{player.name}</span>
            </button>
          ))}
          {roster.length === 0 && (
            <p className="py-4 text-center text-sm text-content-muted">No active players</p>
          )}
        </div>

        {assignedPlayerId && (
          <button
            type="button"
            onClick={onClear}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-danger-line text-sm font-semibold text-danger-content"
          >
            <Trash2 size={16} />
            Clear Slot
          </button>
        )}
      </div>
    </div>
  )
}
