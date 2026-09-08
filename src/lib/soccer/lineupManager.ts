import type { GameState } from '../../types'
import { inspectSoccerHistory } from './live'
import { currentSoccerTargetLineup } from './targetLineup'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventRegistry, gameEventProjectors } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import type { SoccerLineupEntry, SoccerLineupTransitionSource, SoccerMatchProjection, SoccerRole } from './types'

export interface SoccerLineupDraft {
  target: SoccerLineupEntry[]
  benchRoles: Record<string, SoccerRole>
  source: SoccerLineupTransitionSource
  unavailable: Array<{ participantId: string; name: string; reason: string }>
  confirmShort: boolean
}

export type SoccerLineupDraftAction =
  | { type: 'replace'; target: SoccerLineupEntry[]; source: SoccerLineupTransitionSource; unavailable?: SoccerLineupDraft['unavailable'] }
  | { type: 'move'; participantId: string; role: SoccerRole }
  | { type: 'role'; participantId: string; role: SoccerRole }
  | { type: 'confirm'; value: boolean }

export function soccerLineupDraftReducer(draft: SoccerLineupDraft, action: SoccerLineupDraftAction): SoccerLineupDraft {
  if (action.type === 'confirm') return { ...draft, confirmShort: action.value }
  if (action.type === 'replace') return {
    target: structuredClone(action.target), source: action.source,
    unavailable: structuredClone(action.unavailable ?? []), benchRoles: {}, confirmShort: false,
  }
  const role = structuredClone(action.role)
  const included = draft.target.some(entry => entry.participantId === action.participantId)
  if (action.type === 'role' && !included) return {
    ...draft, benchRoles: { ...draft.benchRoles, [action.participantId]: role }, confirmShort: false,
  }
  const target = action.type === 'role'
    ? draft.target.map(entry => entry.participantId === action.participantId ? { ...entry, role } : entry)
    : included ? draft.target.filter(entry => entry.participantId !== action.participantId)
      : [...draft.target, { participantId: action.participantId, role }]
  return { ...draft, target, benchRoles: { ...draft.benchRoles, [action.participantId]: role },
    source: 'manual', unavailable: [], confirmShort: false }
}

export function soccerLineupManagerBlocked(state: GameState, busy: boolean): boolean {
  const projection = state.sportGameState?.sportId === 'soccer' ? state.sportGameState.projection : null
  return busy || !projection || projection.clock.running || state.cloudSync.gameStatus === 'final' ||
    (projection.status !== 'in_progress' && projection.status !== 'period_break')
}

export function soccerLineupSubmitStep(valid: boolean, count: number, maximum: number, confirmed: boolean): 'blocked' | 'confirm' | 'apply' {
  if (!valid) return 'blocked'
  return count < maximum && !confirmed ? 'confirm' : 'apply'
}

export function soccerLineupEntryUnavailable(projection: SoccerMatchProjection, id: string): string | null {
  const participant = projection.participants[id]
  if (!participant) return 'Not in this match'
  if (projection.participantDiscipline[id]?.ejected) return 'Ejected'
  if (participant.status !== 'on_field' && participant.hasExited && !projection.currentRules.allowReturnSubstitutions) return 'Return substitutions disabled'
  return null
}

export function soccerLineupHistoryContext(state: GameState, eventId: string): GameState | null {
  if (!state.eventStream || state.sportGameState?.sportId !== 'soccer') return null
  const inspection = inspectSoccerHistory(state)
  const event = [...inspection.activeEvents, ...inspection.deletedEvents].find(item => item.id === eventId)
  if (!event || event.eventType !== 'soccer.lineup_transition') return null
  const rebuilt = rebuildGameEventProjection({ ...state, eventStream: {
    ...state.eventStream, events: inspection.activeEvents.filter(item => compareGameEventCaptureOrder(item, event) < 0),
  } }, gameEventRegistry, gameEventProjectors)
  return rebuilt.inspection.complete ? rebuilt.state : null
}

export function soccerLineupHistoryDetail(state: GameState, event: GameEvent): string {
  const source = event.payload.source === 'opening_lineup' ? 'Opening Lineup'
    : event.payload.source === 'team_default' ? 'Team Default' : 'Manual lineup'
  const context = soccerLineupHistoryContext(state, event.id)
  const target = event.payload.onField as SoccerLineupEntry[]
  if (context?.sportGameState?.sportId !== 'soccer' || !Array.isArray(target)) return `${source} · Earlier lineup unavailable`
  const previous = currentSoccerTargetLineup(context.sportGameState.projection)
  const old = new Map(previous.map(entry => [entry.participantId, entry.role]))
  const ids = new Set(target.map(entry => entry.participantId))
  const entering = target.filter(entry => !old.has(entry.participantId)).length
  const leaving = previous.filter(entry => !ids.has(entry.participantId)).length
  const roles = target.filter(entry => {
    const prior = old.get(entry.participantId)
    return prior && (prior.group !== entry.role.group || prior.label !== entry.role.label)
  }).length
  return `${source} · ${entering} entering · ${leaving} leaving · ${roles} role changes${event.payload.halftime ? ' · Halftime' : ''}`
}

export function soccerLineupPreset(state: GameState, source: SoccerLineupTransitionSource): {
  onField: SoccerLineupEntry[]
  unavailable: Array<{ participantId: string; name: string; reason: string }>
} | null {
  if (state.sportGameState?.sportId !== 'soccer') return null
  const { setup, projection } = state.sportGameState
  const opening = source === 'opening_lineup'
    ? inspectSoccerHistory(state).activeEvents.find(event => event.eventType === 'soccer.opening_lineup') : null
  const entries = source === 'manual' ? currentSoccerTargetLineup(projection)
    : source === 'opening_lineup' ? opening?.payload.starters
      : setup.version === 2 ? setup.teamDefaultLineup?.entries : null
  if (!entries) return null
  const unavailable: Array<{ participantId: string; name: string; reason: string }> = []
  const onField = entries.filter(entry => {
    const reason = soccerLineupEntryUnavailable(projection, entry.participantId)
    if (!reason) return true
    unavailable.push({ participantId: entry.participantId,
      name: projection.participants[entry.participantId]?.displayName ?? setup.participants.find(p => p.id === entry.participantId)?.displayName ?? entry.participantId,
      reason })
    return false
  })
  return { onField: structuredClone(onField), unavailable }
}
