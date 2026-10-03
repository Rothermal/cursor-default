import type { GameState } from '../../types'
import type { GameEvent, GameEventActor, GameEventLocation } from '../gameEvents/types'
import {
  baseballCaptureFallbackReason,
  baseballCaptureTerminal,
  createBaseballResolutionRows,
  proposeBaseballCaptureMovements,
  type BaseballBattedBall,
  type BaseballInPlayDraft,
  type BaseballPendingCapture,
  type BaseballResolutionRow,
} from './capture'
import { stableJson } from '../gameEvents/stream'
import type { BaseballSubstitutionChoices, BaseballSubstitutionDraft } from './substitutionOptions'
import { baseballSportState, resolveBaseballActors } from './commands'
import type { BaseballEventEdit } from './corrections'
import { baseballSubstitutionChanges } from './events'
import { replayBaseballEvents } from './projector'
import type {
  BaseballBaserunningPayload,
  BaseballEventType,
  BaseballPayloadByType,
  BaseballPitchPayload,
  BaseballPlateAppearancePayload,
  BaseballRunnerMovement,
  BaseballScoreAdjustmentPayload,
  BaseballSportGameState,
  BaseballSubstitution,
  BaseballTeamSide,
} from './types'
import { baseballFieldingPositionCode } from './positions'
import { baseballActiveEvents, groupBaseballUnits } from './units'

/**
 * Edit any play (BSB-4D). An edit reopens the sheet the play was recorded with, seeded from
 * the stored event and from the game as it stood just before it (a prefix replay), so
 * proposals, legal choices and RBI rules match capture time. The edited event keeps its type,
 * period, team, time and place in the order; stamped actors are kept unless the edit changes
 * that role (section 4D).
 */

/** What the edit sheet starts from. */
export type BaseballEditSeed =
  | {
      kind: 'capture'
      capture: BaseballPendingCapture
      /** The stored movements, used as the resolution rows while the result is unchanged. */
      movements: BaseballRunnerMovement[]
    }
  | { kind: 'substitution'; side: BaseballTeamSide; changes: BaseballSubstitution[] }
  | { kind: 'score'; side: BaseballTeamSide; delta: number; reason: string }

export interface BaseballEditTarget {
  event: GameEvent
  /** The game as it stood just before the play: setup and preferences unchanged, projection from the prefix replay. */
  prefix: BaseballSportGameState
  seed: BaseballEditSeed
}

export type BaseballEditTargetResult = { ok: true; target: BaseballEditTarget } | { ok: false; message: string }

/** The play behind a Timeline row, ready to edit. */
export function baseballEditTarget(state: GameState, unitId: string): BaseballEditTargetResult {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return { ok: false, message: 'This is not a Baseball event game.' }
  const active = baseballActiveEvents(state)
  const unit = groupBaseballUnits(active).find(candidate => candidate[0].id === unitId)
  if (!unit) return { ok: false, message: 'That play is no longer in the game.' }
  if (unit.length !== 1) return { ok: false, message: 'This entry was recorded in several parts; remove it and record it again.' }
  const event = unit[0]
  const index = active.indexOf(event)
  const replay = replayBaseballEvents(sport.setup, active.slice(0, index))
  if (replay.diagnostics.length > 0) return { ok: false, message: replay.diagnostics[0].message }
  const prefix: BaseballSportGameState = { ...sport, projection: replay.projection }
  const seed = seedFor(event)
  if (!seed) return { ok: false, message: 'This entry cannot be edited.' }
  return { ok: true, target: { event, prefix, seed } }
}

function seedFor(event: GameEvent): BaseballEditSeed | null {
  const side = event.teamSide === 'opponent' ? 'opponent' : 'tracked'
  switch (event.eventType as BaseballEventType) {
    case 'baseball.pitch': {
      const payload = event.payload as unknown as BaseballPitchPayload
      return {
        kind: 'capture',
        capture: {
          source: 'pitch',
          result: payload.result,
          pitchLocation: payload.pitchLocation,
          battedBall: battedBall(payload.inPlay, event.location),
          droppedThirdStrike: payload.movements.some(movement => movement.reason === 'dropped_third_strike'),
        },
        movements: payload.movements,
      }
    }
    case 'baseball.plate_appearance': {
      const payload = event.payload as unknown as BaseballPlateAppearancePayload
      return {
        kind: 'capture',
        capture: {
          source: 'quick',
          result: payload.result,
          battedBall: battedBall(payload.inPlay, event.location),
          finalBalls: payload.finalBalls,
          finalStrikes: payload.finalStrikes,
        },
        movements: payload.movements,
      }
    }
    case 'baseball.baserunning': {
      const payload = event.payload as unknown as BaseballBaserunningPayload
      return {
        kind: 'capture',
        capture: { source: 'baserunning', play: payload.play, runnerId: payload.movements[0]?.runnerId ?? '' },
        movements: payload.movements,
      }
    }
    case 'baseball.substitution':
      return { kind: 'substitution', side, changes: baseballSubstitutionChanges(event.payload) }
    case 'baseball.score_adjustment': {
      const payload = event.payload as unknown as BaseballScoreAdjustmentPayload
      return { kind: 'score', side, delta: payload.delta, reason: payload.reason }
    }
    default:
      return null
  }
}

function battedBall(inPlay: BaseballPitchPayload['inPlay'], location: GameEventLocation | null): BaseballBattedBall | null {
  return inPlay ? { inPlay: { ...inPlay, fielders: [...inPlay.fielders] }, location: location ? { x: location.x, y: location.y } : null } : null
}

/** The in-play sheet seeded from a recorded batted ball. */
export function baseballInPlayDraftFrom(battedBall: BaseballBattedBall | null): BaseballInPlayDraft {
  if (!battedBall) return { result: null, battedBallType: 'unknown', insideThePark: false, location: null, fielders: [], errorBy: null }
  const { inPlay, location } = battedBall
  return {
    result: inPlay.result,
    battedBallType: inPlay.battedBallType,
    insideThePark: inPlay.insideThePark,
    location,
    fielders: [...inPlay.fielders],
    errorBy: inPlay.errorBy,
  }
}

/**
 * Runner rows for an edited capture: the stored movements while the play itself is unchanged
 * (only locations may differ), otherwise the engine's proposal for the new result, both read
 * against the game just before the play.
 */
export function baseballEditResolutionRows(target: BaseballEditTarget, capture: BaseballPendingCapture): BaseballResolutionRow[] {
  const { prefix, seed } = target
  const terminal = baseballCaptureTerminal(prefix, capture)
  const same = seed.kind === 'capture' && stableJson(playShape(seed.capture)) === stableJson(playShape(capture))
  const movements = same && seed.kind === 'capture' ? seed.movements : proposeBaseballCaptureMovements(prefix, capture)
  return createBaseballResolutionRows(prefix.projection, movements, terminal !== null, baseballCaptureFallbackReason(prefix, capture))
}

/** What decides the runners: everything but the pitch and batted-ball locations. */
function playShape(capture: BaseballPendingCapture): unknown {
  if (capture.source === 'pitch') {
    return { ...capture, pitchLocation: null, battedBall: capture.battedBall ? { inPlay: capture.battedBall.inPlay } : null }
  }
  if (capture.source === 'quick') return { ...capture, battedBall: capture.battedBall ? { inPlay: capture.battedBall.inPlay } : null }
  return capture
}

/** The substitution sheet seeded with the recorded change when it is still a listed option. */
export function baseballSubstitutionEditDraft(choices: BaseballSubstitutionChoices, changes: readonly BaseballSubstitution[]): BaseballSubstitutionDraft {
  const wanted = stableJson(changes)
  for (const [kind, groups] of Object.entries(choices) as Array<[keyof BaseballSubstitutionChoices, BaseballSubstitutionChoices[keyof BaseballSubstitutionChoices]]>) {
    for (const group of groups) {
      const option = group.options.find(entry => stableJson(entry.changes) === wanted)
      if (option) return { kind, groupKey: group.key, optionKey: option.key, ...(option.doubleSwitch ? { parts: { ...option.doubleSwitch } } : {}) }
    }
  }
  return { kind: null, groupKey: null, optionKey: null }
}

/** A capture's edit: the new payload, batted-ball location and actors for the stored event. */
export function baseballCaptureEdit(
  target: BaseballEditTarget,
  capture: BaseballPendingCapture,
  movements: BaseballRunnerMovement[]
): BaseballEventEdit {
  const { event } = target
  let payload: BaseballPayloadByType['baseball.pitch' | 'baseball.plate_appearance' | 'baseball.baserunning']
  let location: GameEventLocation | null = null
  if (capture.source === 'pitch') {
    payload = {
      captureCommandId: null,
      result: capture.result,
      pitchLocation: capture.pitchLocation,
      inPlay: capture.battedBall?.inPlay ?? null,
      movements,
    }
    location = diamondLocation(capture.battedBall?.location ?? null)
  } else if (capture.source === 'quick') {
    payload = {
      captureCommandId: null,
      result: capture.result,
      inPlay: capture.battedBall?.inPlay ?? null,
      finalBalls: capture.finalBalls,
      finalStrikes: capture.finalStrikes,
      movements,
    }
    location = diamondLocation(capture.battedBall?.location ?? null)
  } else {
    payload = { captureCommandId: null, play: capture.play, movements }
  }
  return {
    eventId: event.id,
    payload: payload as unknown as GameEvent['payload'],
    location,
    actors: baseballEditActors(target, payload),
  }
}

export function baseballSubstitutionEdit(target: BaseballEditTarget, changes: readonly BaseballSubstitution[]): BaseballEventEdit {
  return {
    eventId: target.event.id,
    payload: { captureCommandId: null, changes: changes.map(change => ({ ...change })) } as unknown as GameEvent['payload'],
    location: null,
    actors: target.event.actors,
  }
}

export function baseballScoreAdjustmentEdit(target: BaseballEditTarget, delta: number, reason: string): BaseballEventEdit {
  return {
    eventId: target.event.id,
    payload: { captureCommandId: null, delta, reason } as unknown as GameEvent['payload'],
    location: null,
    actors: target.event.actors,
  }
}

/**
 * Stamped actors after an edit: every role the play already had keeps its participant, even
 * when the prefix lineup now shows someone else. Fielder roles the new payload adds are
 * stamped from the prefix defense, and roles it no longer uses are dropped. Batter and
 * pitcher stamps stay as recorded.
 */
export function baseballEditActors(
  target: BaseballEditTarget,
  payload: BaseballPayloadByType[BaseballEventType]
): GameEventActor[] {
  const { event, prefix } = target
  const wanted = resolveBaseballActors(prefix.setup, prefix.projection, event.eventType as BaseballEventType, payload)
  const wantedRoles = new Set(wanted.map(actor => actor.role))
  const existing = new Map(event.actors.map(actor => [actor.role, actor]))
  const kept = event.actors.filter(actor => !actor.role.startsWith('fielder_') || wantedRoles.has(actor.role))
  const added = wanted.filter(actor => actor.role.startsWith('fielder_') && !existing.has(actor.role))
  return [...kept, ...added].sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
}

function roleOrder(role: string): number {
  if (role === 'batter') return 0
  if (role === 'pitcher') return 1
  return 2 + Number(role.slice('fielder_'.length))
}

/**
 * Repair attribution: restamps the chosen roles to the participant the replayed lineup shows
 * (the role's `actor_mismatch` warning). Other roles keep their stamp.
 */
export function baseballRepairAttributionEdit(
  state: GameState,
  eventId: string,
  roles: readonly string[]
): { ok: true; edit: BaseballEventEdit } | { ok: false; message: string } {
  const sport = baseballSportState(state)
  if (!sport) return { ok: false, message: 'This is not a Baseball event game.' }
  const event = baseballActiveEvents(state).find(entry => entry.id === eventId)
  if (!event) return { ok: false, message: 'That play is no longer in the game.' }
  const target = baseballEditTarget(state, groupBaseballUnits(baseballActiveEvents(state)).find(unit => unit.some(entry => entry.id === eventId))?.[0].id ?? eventId)
  if (!target.ok) return target
  const fixes = new Map(
    sport.projection.warnings
      .filter(warning => warning.eventId === eventId && (roles as readonly string[]).includes(warning.role) && warning.resolvedParticipantId)
      .map(warning => [warning.role as string, warning.resolvedParticipantId!] as const)
  )
  if (fixes.size === 0) return { ok: false, message: 'Choose a role that does not match the lineup.' }
  const resolved = resolveBaseballActors(target.target.prefix.setup, target.target.prefix.projection, event.eventType as BaseballEventType, event.payload as BaseballPayloadByType[BaseballEventType])
  const actors = event.actors.map(actor => {
    const participantId = fixes.get(actor.role)
    if (!participantId) return actor
    const fresh = resolved.find(entry => entry.role === actor.role && entry.participantId === participantId)
    return fresh ?? { ...actor, participantId }
  })
  return { ok: true, edit: { eventId, payload: event.payload, location: event.location, actors } }
}

/** The roles on a play whose stamp differs from the replayed lineup, for Repair attribution. */
export function baseballMismatchedRoles(state: GameState, eventId: string): Array<{ role: string; message: string }> {
  const sport = baseballSportState(state)
  return (sport?.projection.warnings ?? [])
    .filter(warning => warning.eventId === eventId && warning.resolvedParticipantId)
    .map(warning => ({ role: warning.role, message: warning.message }))
}

/** A stamped role's name for Repair attribution: Batter, Pitcher or the fielder's position. */
export function baseballRoleLabel(role: string): string {
  if (role === 'batter') return 'Batter'
  if (role === 'pitcher') return 'Pitcher'
  const position = Number(role.slice('fielder_'.length))
  return `Fielder at ${baseballFieldingPositionCode(position) ?? position}`
}

function diamondLocation(value: { x: number; y: number } | null): GameEventLocation | null {
  if (!value) return null
  return { x: Math.min(1, Math.max(0, value.x)), y: Math.min(1, Math.max(0, value.y)), attackingDirection: 'unknown' }
}
