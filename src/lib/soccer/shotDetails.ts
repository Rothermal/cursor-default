import type { GameEvent, GameEventEditableFields, GameEventLocation, JsonObject } from '../gameEvents/types'
import type { GameState } from '../../types'
import { isGameEventEnvelope, isPlainObject } from '../gameEvents/envelope'
import { SOCCER_DIAGRAM } from './diagramGeometry'

export type SoccerBodyPart = 'left_foot' | 'right_foot' | 'header'
export type SoccerGoalPlacement = { x: number; y: number }
export type SoccerShotDetails = {
  bodyPart?: SoccerBodyPart
  goalPlacement?: SoccerGoalPlacement
}

export function isSoccerShotDetailFamily(type: string): boolean {
  return ['soccer.shot', 'soccer.own_goal', 'soccer.shootout_kick'].includes(type)
}

export type SoccerShotDetailInput = {
  bodyPart?: SoccerBodyPart | null
  goalPlacement?: SoccerGoalPlacement | null
}

export interface ShotDetailDraft {
  bodyPart: SoccerBodyPart | null
  goalPlacement: SoccerGoalPlacement | null
}

export function shotDetailDraft(event?: GameEvent | null): ShotDetailDraft {
  if (!event || !isSoccerShotDetailFamily(event.eventType) || !validateSoccerShotDetails(event.eventType, event.payload)) {
    return { bodyPart: null, goalPlacement: null }
  }
  return {
    bodyPart: (event.payload.bodyPart as SoccerBodyPart | undefined) ?? null,
    goalPlacement: event.payload.goalPlacement ? structuredClone(event.payload.goalPlacement) as SoccerGoalPlacement : null,
  }
}

export function soccerShotDetailInput(input: SoccerShotDetailInput): JsonObject {
  const result: JsonObject = {}
  if (input.bodyPart !== undefined) result.bodyPart = input.bodyPart
  if (input.goalPlacement !== undefined) result.goalPlacement = input.goalPlacement
  return result
}

export function soccerBodyPartLabel(value: unknown): string {
  return value === 'left_foot' ? 'Left foot' : value === 'right_foot' ? 'Right foot'
    : value === 'header' ? 'Header' : 'Unspecified'
}

export function soccerScoringDirection(side: 'tracked' | 'opponent', direction: 'left_to_right' | 'right_to_left') {
  return side === 'tracked' ? direction : direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

export function preserveSoccerEventDetailChanges(
  state: GameState, eventId: string, changes: Partial<GameEventEditableFields>
): Partial<GameEventEditableFields> {
  const previous = state.eventStream?.events.find(event => isGameEventEnvelope(event) && event.id === eventId)
  if (!previous || !isGameEventEnvelope(previous) || previous.sportId !== 'soccer' ||
    !isSoccerShotDetailFamily(previous.eventType) || !changes.payload) return changes
  return { ...changes, payload: preserveSoccerShotDetails(previous.eventType, previous.payload, changes.payload) }
}

export function soccerPlacementAllowed(type: string, payload: JsonObject): boolean {
  return type === 'soccer.own_goal' ||
    (type === 'soccer.shot' && payload.outcome === 'goal') ||
    (type === 'soccer.shootout_kick' && payload.outcome === 'scored')
}

export function validateSoccerShotDetails(type: string, payload: JsonObject): boolean {
  if (has(payload, 'bodyPart')) {
    const allowed = type === 'soccer.shootout_kick'
      ? ['left_foot', 'right_foot'] : ['left_foot', 'right_foot', 'header']
    if (!allowed.includes(String(payload.bodyPart)) || typeof payload.bodyPart !== 'string') return false
  }
  if (has(payload, 'goalPlacement')) {
    const p = payload.goalPlacement
    if (!soccerPlacementAllowed(type, payload) || !isPlainObject(p) ||
      Object.keys(p).length !== 2 || !unit(p.x) || !unit(p.y)) return false
  }
  return true
}

// Correction inputs may clear with null; persisted payloads represent absence by omission.
export function preserveSoccerShotDetails(type: string, previous: JsonObject, replacement: JsonObject): JsonObject {
  const result = structuredClone(replacement)
  for (const key of ['bodyPart', 'goalPlacement'] as const) {
    if (!has(replacement, key) && has(previous, key)) result[key] = structuredClone(previous[key])
    if (result[key] === null) delete result[key]
  }
  if (!soccerPlacementAllowed(type, result)) delete result.goalPlacement
  return result
}

export function soccerShotApproach(location: GameEventLocation | null, placement: SoccerGoalPlacement | null = null): {
  degrees: number; origin: { x: number; y: number }; goal: { x: number; y: number }
} | null {
  if (!location || !unit(location.x) || !unit(location.y) ||
    !['left_to_right', 'right_to_left'].includes(location.attackingDirection)) return null
  const rightward = location.attackingDirection === 'left_to_right'
  const offset = placement && unit(placement.x)
    ? (placement.x - 0.5) * SOCCER_DIAGRAM.goalWidth / SOCCER_DIAGRAM.width : 0
  // Goal-mouth left/right is from the shooter facing the entered goal.
  const goal = { x: rightward ? 1 : 0, y: 0.5 + offset * (rightward ? 1 : -1) }
  const longitudinal = Math.abs(goal.x - location.x) * SOCCER_DIAGRAM.length
  const lateral = Math.abs(goal.y - location.y) * SOCCER_DIAGRAM.width
  // Only coincident diagram points are undefined; a goal-line origin otherwise yields 90 degrees.
  if (Math.hypot(longitudinal, lateral) < 1e-9) return null
  return { degrees: Math.round(Math.atan2(lateral, longitudinal) * 180 / Math.PI),
    origin: { x: location.x, y: location.y }, goal }
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function has(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
