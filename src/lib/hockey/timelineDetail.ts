import type { GameEvent } from '../gameEvents/types'
import { hockeyOpponentGoalieLabel, hockeyParticipantLabel } from './captureCommands'
import { formatHockeyClock } from './live'
import type { HockeyMatchSetup, HockeyOpponentGoalie } from './types'
import { HOCKEY_EMPTY_NET } from './types'

/**
 * The Timeline detail sheet's fields (HKY-4A): every actor and every recorded payload field
 * of an event, with participant and opponent goalie ids shown by name. Nothing recorded is
 * dropped: an unrecognized value is shown as stored.
 */

export interface HockeyTimelineDetailField {
  label: string
  value: string
}

/** Display names by id: tracked participants and every opponent goalie the stream names. */
export type HockeyTimelineNames = Readonly<Record<string, string>>

const ROLE_LABELS: Record<string, string> = {
  shooter: 'Shooter',
  assist_primary: 'Assist',
  assist_secondary: 'Second assist',
  goalie: 'Goalie',
  blocker: 'Blocked by',
  taker: 'Faceoff taker',
  hitter: 'Hitter',
  hit_player: 'Player hit',
  player: 'Player',
  offender: 'Offender',
  served_by: 'Served by',
  drawn_by: 'Drawn by',
}

const FIELD_LABELS: Record<string, string> = {
  goalieParticipantId: 'Goalie',
  skaterParticipantIds: 'Skaters',
  opponentGoalieId: 'Opponent goalie',
  inParticipantId: 'Goalie in',
  placement: 'Placed',
  recordedLater: 'Recorded later',
  retimed: 'Re-timed',
}

const PLACEMENT_LABELS: Record<string, string> = { game_time: 'At its game time', period_start: 'At the start of the period' }

const STRENGTH_LABELS: Record<string, string> = { ev: 'Even strength', pp: 'Power play', sh: 'Short-handed' }

/** Payload keys that are plumbing rather than something the recorder chose. */
const HIDDEN_PAYLOAD_KEYS = new Set(['captureCommandId', 'coincidenceGroupId', 'newOpponentGoalie', 'penaltyEventId'])

/**
 * Names for the detail sheet. Opponent goalies come from setup and from every goalie change
 * in the stream, removed ones included, so a stamped goalie keeps its historical label.
 */
export function hockeyTimelineNames(setup: HockeyMatchSetup, events: readonly GameEvent[]): Record<string, string> {
  const names: Record<string, string> = { [HOCKEY_EMPTY_NET]: 'Empty net' }
  const addGoalie = (goalie: HockeyOpponentGoalie) => {
    names[goalie.id] = hockeyOpponentGoalieLabel(goalie)
  }
  addGoalie(setup.opponentGoalie)
  for (const event of events) {
    if (event.eventType !== 'hockey.goalie_change') continue
    const incoming = (event.payload as { newOpponentGoalie?: HockeyOpponentGoalie | null }).newOpponentGoalie
    if (incoming && typeof incoming.id === 'string') addGoalie(incoming)
  }
  for (const participant of setup.participants) names[participant.id] = hockeyParticipantLabel(participant)
  return names
}

export function hockeyTimelineEventFields(event: GameEvent, names: HockeyTimelineNames): HockeyTimelineDetailField[] {
  const name = (id: string) => names[id] ?? 'Unknown player'
  const fields: HockeyTimelineDetailField[] = event.actors.map(actor => ({
    label: ROLE_LABELS[actor.role] ?? humanize(actor.role),
    value: actor.participantId ? name(actor.participantId) : actor.label ?? 'Not named',
  }))
  for (const [key, value] of Object.entries(event.payload as Record<string, unknown>)) {
    if (HIDDEN_PAYLOAD_KEYS.has(key) || value === null || value === undefined) continue
    fields.push({ label: FIELD_LABELS[key] ?? humanize(key), value: formatValue(key, value, name) })
  }
  return fields
}

function formatValue(key: string, value: unknown, name: (id: string) => string): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return key.endsWith('Ms') ? formatHockeyClock(value) : String(value)
  if (typeof value === 'string') {
    if (isIdKey(key)) return name(value)
    if (key === 'strength') return STRENGTH_LABELS[value] ?? value.toUpperCase()
    if (key === 'placement') return PLACEMENT_LABELS[value] ?? humanize(value)
    return key === 'reason' || key.endsWith('Label') ? value : humanize(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None'
    return value.map(entry => typeof entry === 'string' && isIdKey(key) ? name(entry) : formatScalar(entry)).join(', ')
  }
  if (key === 'onIce' && typeof value === 'object') {
    const onIce = value as { skaterParticipantIds?: string[]; goalie?: string | null; status?: string }
    if (onIce.status === 'not_recorded') return 'Not recorded'
    const skaters = (onIce.skaterParticipantIds ?? []).map(name).join(', ')
    const goalie = onIce.goalie ? `, goalie ${name(onIce.goalie)}` : ''
    return `${skaters || 'No skaters'}${goalie}${onIce.status === 'partial' ? ' (partial)' : ''}`
  }
  return JSON.stringify(value)
}

function isIdKey(key: string): boolean {
  return key.endsWith('ParticipantId') || key.endsWith('ParticipantIds') || key === 'opponentGoalieId'
}

function formatScalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)
}


function humanize(key: string): string {
  const words = key
    .replace(/Ms$/, '')
    .replace(/Ids?$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
