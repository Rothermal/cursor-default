import { isPlainObject } from '../gameEvents/envelope'
import type { SoccerRole, SoccerRoleGroup, SoccerRosterStatus } from './types'

export const SOCCER_FORMATION_TEMPLATE_IDS = [
  '11v11-4-3-3',
  '11v11-4-4-2',
  '11v11-3-4-3',
  '9v9-3-3-2',
  '9v9-3-2-3',
  '9v9-2-3-3',
  '7v7-2-3-1',
  '7v7-3-2-1',
  '7v7-2-2-2',
] as const

export const SOCCER_FORMATION_SLOT_IDS = [
  'gk',
  'lb',
  'lcb',
  'cb',
  'rcb',
  'rb',
  'lm',
  'lcm',
  'cm',
  'rcm',
  'rm',
  'lw',
  'lst',
  'st',
  'rst',
  'rw',
] as const

export type SoccerFormationTemplateId = typeof SOCCER_FORMATION_TEMPLATE_IDS[number]
export type SoccerFormationSlotId = typeof SOCCER_FORMATION_SLOT_IDS[number]
export type SoccerFormationRoleGroup = Exclude<SoccerRoleGroup, 'custom'>

export interface SoccerFormationSlotDefinition {
  id: SoccerFormationSlotId
  label: string
  roleGroup: SoccerFormationRoleGroup
  x: number
  y: number
}

export interface SoccerFormationTemplate {
  id: SoccerFormationTemplateId
  label: string
  playerCount: 7 | 9 | 11
  slots: readonly SoccerFormationSlotDefinition[]
}

export interface SoccerTeamFormationV1 {
  version: 1
  templateId: SoccerFormationTemplateId
  assignments: Partial<Record<SoccerFormationSlotId, string>>
}

export type SoccerFormationParseResult =
  | { ok: true; value: SoccerTeamFormationV1 }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function slot(
  id: SoccerFormationSlotId,
  label: string,
  roleGroup: SoccerFormationRoleGroup,
  x: number,
  y: number
): SoccerFormationSlotDefinition {
  return Object.freeze({ id, label, roleGroup, x, y })
}

const GK = () => slot('gk', 'GK', 'goalkeeper', 0.5, 0.92)
const DEFENDERS_4 = () => [
  slot('lb', 'LB', 'defender', 0.12, 0.72),
  slot('lcb', 'LCB', 'defender', 0.38, 0.72),
  slot('rcb', 'RCB', 'defender', 0.62, 0.72),
  slot('rb', 'RB', 'defender', 0.88, 0.72),
] as const
const DEFENDERS_3 = () => [
  slot('lcb', 'LCB', 'defender', 0.22, 0.72),
  slot('cb', 'CB', 'defender', 0.5, 0.72),
  slot('rcb', 'RCB', 'defender', 0.78, 0.72),
] as const
const DEFENDERS_2 = () => [
  slot('lcb', 'LCB', 'defender', 0.34, 0.72),
  slot('rcb', 'RCB', 'defender', 0.66, 0.72),
] as const
const MIDFIELDERS_4 = () => [
  slot('lm', 'LM', 'midfielder', 0.12, 0.46),
  slot('lcm', 'LCM', 'midfielder', 0.38, 0.46),
  slot('rcm', 'RCM', 'midfielder', 0.62, 0.46),
  slot('rm', 'RM', 'midfielder', 0.88, 0.46),
] as const
const MIDFIELDERS_3 = () => [
  slot('lm', 'LM', 'midfielder', 0.22, 0.46),
  slot('cm', 'CM', 'midfielder', 0.5, 0.46),
  slot('rm', 'RM', 'midfielder', 0.78, 0.46),
] as const
const CENTRAL_MIDFIELDERS_3 = () => [
  slot('lcm', 'LCM', 'midfielder', 0.22, 0.46),
  slot('cm', 'CM', 'midfielder', 0.5, 0.46),
  slot('rcm', 'RCM', 'midfielder', 0.78, 0.46),
] as const
const MIDFIELDERS_2 = () => [
  slot('lcm', 'LCM', 'midfielder', 0.36, 0.46),
  slot('rcm', 'RCM', 'midfielder', 0.64, 0.46),
] as const
const FORWARDS_3 = () => [
  slot('lw', 'LW', 'forward', 0.2, 0.2),
  slot('st', 'ST', 'forward', 0.5, 0.2),
  slot('rw', 'RW', 'forward', 0.8, 0.2),
] as const
const FORWARDS_2 = () => [
  slot('lst', 'LST', 'forward', 0.36, 0.2),
  slot('rst', 'RST', 'forward', 0.64, 0.2),
] as const
const FORWARD_1 = () => [slot('st', 'ST', 'forward', 0.5, 0.2)] as const

function template(
  id: SoccerFormationTemplateId,
  label: string,
  playerCount: 7 | 9 | 11,
  slots: readonly SoccerFormationSlotDefinition[]
): SoccerFormationTemplate {
  return Object.freeze({ id, label, playerCount, slots: Object.freeze([...slots]) })
}

export const SOCCER_FORMATION_TEMPLATES: readonly SoccerFormationTemplate[] = Object.freeze([
  template('11v11-4-3-3', '4-3-3', 11, [GK(), ...DEFENDERS_4(), ...CENTRAL_MIDFIELDERS_3(), ...FORWARDS_3()]),
  template('11v11-4-4-2', '4-4-2', 11, [GK(), ...DEFENDERS_4(), ...MIDFIELDERS_4(), ...FORWARDS_2()]),
  template('11v11-3-4-3', '3-4-3', 11, [GK(), ...DEFENDERS_3(), ...MIDFIELDERS_4(), ...FORWARDS_3()]),
  template('9v9-3-3-2', '3-3-2', 9, [GK(), ...DEFENDERS_3(), ...MIDFIELDERS_3(), ...FORWARDS_2()]),
  template('9v9-3-2-3', '3-2-3', 9, [GK(), ...DEFENDERS_3(), ...MIDFIELDERS_2(), ...FORWARDS_3()]),
  template('9v9-2-3-3', '2-3-3', 9, [GK(), ...DEFENDERS_2(), ...MIDFIELDERS_3(), ...FORWARDS_3()]),
  template('7v7-2-3-1', '2-3-1', 7, [GK(), ...DEFENDERS_2(), ...MIDFIELDERS_3(), ...FORWARD_1()]),
  template('7v7-3-2-1', '3-2-1', 7, [GK(), ...DEFENDERS_3(), ...MIDFIELDERS_2(), ...FORWARD_1()]),
  template('7v7-2-2-2', '2-2-2', 7, [GK(), ...DEFENDERS_2(), ...MIDFIELDERS_2(), ...FORWARDS_2()]),
])

export function getSoccerFormationTemplate(
  id: unknown
): SoccerFormationTemplate | null {
  if (typeof id !== 'string') return null
  return SOCCER_FORMATION_TEMPLATES.find(candidate => candidate.id === id) ?? null
}

export function soccerFormationTemplatesForCount(
  playerCount: number
): readonly SoccerFormationTemplate[] {
  return SOCCER_FORMATION_TEMPLATES.filter(template => template.playerCount === playerCount)
}

export function parseSoccerTeamFormation(value: unknown): SoccerFormationParseResult {
  if (!hasExactKeys(value, ['version', 'templateId', 'assignments'])) {
    return invalid('Soccer formation must use the exact schema.')
  }
  if (value.version !== 1) return invalid('Soccer formation version is unsupported.')
  const template = getSoccerFormationTemplate(value.templateId)
  if (!template) return invalid('Soccer formation template is unknown.')
  if (!isPlainObject(value.assignments)) {
    return invalid('Soccer formation assignments must be an object.')
  }

  const allowedSlots = new Set(template.slots.map(candidate => candidate.id))
  const players = new Set<string>()
  const assignments: Partial<Record<SoccerFormationSlotId, string>> = {}
  for (const [slotId, playerId] of Object.entries(value.assignments)) {
    if (!allowedSlots.has(slotId as SoccerFormationSlotId)) {
      return invalid(`Soccer formation slot ${slotId} is invalid for ${template.id}.`)
    }
    if (typeof playerId !== 'string' || !UUID_PATTERN.test(playerId)) {
      return invalid('Soccer formation player ids must be UUIDs.')
    }
    const normalizedPlayerId = playerId.toLowerCase()
    if (players.has(normalizedPlayerId)) {
      return invalid('A soccer formation player may occupy only one slot.')
    }
    players.add(normalizedPlayerId)
  }
  for (const definition of template.slots) {
    const playerId = value.assignments[definition.id]
    if (typeof playerId === 'string') assignments[definition.id] = playerId.toLowerCase()
  }

  return {
    ok: true,
    value: { version: 1, templateId: template.id, assignments },
  }
}

export function createSoccerTeamFormation(
  templateId: SoccerFormationTemplateId
): SoccerTeamFormationV1 {
  return { version: 1, templateId, assignments: {} }
}

export function assignSoccerFormationPlayer(
  formation: SoccerTeamFormationV1,
  slotId: SoccerFormationSlotId,
  playerId: string
): SoccerTeamFormationV1 {
  const template = getSoccerFormationTemplate(formation.templateId)
  if (!template?.slots.some(candidate => candidate.id === slotId)) {
    return structuredClone(formation)
  }
  const assignments: Partial<Record<SoccerFormationSlotId, string>> = {}
  for (const definition of template.slots) {
    const assignedPlayerId = formation.assignments[definition.id]
    if (assignedPlayerId && assignedPlayerId !== playerId && definition.id !== slotId) {
      assignments[definition.id] = assignedPlayerId
    }
  }
  assignments[slotId] = playerId
  return { version: 1, templateId: formation.templateId, assignments }
}

export function clearSoccerFormationSlot(
  formation: SoccerTeamFormationV1,
  slotId: SoccerFormationSlotId
): SoccerTeamFormationV1 {
  const next = structuredClone(formation)
  delete next.assignments[slotId]
  return next
}

export function switchSoccerFormationTemplate(
  formation: SoccerTeamFormationV1,
  templateId: SoccerFormationTemplateId
): SoccerTeamFormationV1 {
  const template = getSoccerFormationTemplate(templateId)
  if (!template) return structuredClone(formation)
  const assignments: Partial<Record<SoccerFormationSlotId, string>> = {}
  for (const definition of template.slots) {
    const playerId = formation.assignments[definition.id]
    if (playerId) assignments[definition.id] = playerId
  }
  return { version: 1, templateId, assignments }
}

export function unavailableSoccerFormationPlayerIds(
  formation: SoccerTeamFormationV1,
  activePlayerIds: Iterable<string>
): string[] {
  const active = new Set(activePlayerIds)
  const template = getSoccerFormationTemplate(formation.templateId)
  if (!template) return []
  return template.slots.flatMap(definition => {
    const playerId = formation.assignments[definition.id]
    return playerId && !active.has(playerId) ? [playerId] : []
  })
}

export function prepareSoccerFormationForSave(
  formation: SoccerTeamFormationV1,
  activePlayerIds: Iterable<string>
): SoccerTeamFormationV1 {
  const active = new Set(activePlayerIds)
  const template = getSoccerFormationTemplate(formation.templateId)
  if (!template) return structuredClone(formation)
  const assignments: Partial<Record<SoccerFormationSlotId, string>> = {}
  for (const definition of template.slots) {
    const playerId = formation.assignments[definition.id]
    if (playerId && active.has(playerId)) assignments[definition.id] = playerId
  }
  return { version: 1, templateId: formation.templateId, assignments }
}

export interface SoccerFormationParticipantDraft {
  playerId: string | null
  selected: boolean
  initialStatus: SoccerRosterStatus
  initialRole: SoccerRole
}

export type SoccerFormationApplicationStatus =
  | 'applied'
  | 'no_formation'
  | 'count_mismatch'
  | 'invalid'

export interface SoccerFormationApplicationResult<TDraft> {
  status: SoccerFormationApplicationStatus
  drafts: TDraft[]
  unavailablePlayerIds: string[]
  error: string | null
}

export function applySoccerFormationToRosterDrafts<
  TDraft extends SoccerFormationParticipantDraft,
>(
  drafts: readonly TDraft[],
  formation: unknown,
  maxOnFieldPlayers: number
): SoccerFormationApplicationResult<TDraft> {
  const fallback = drafts.map(draft => structuredClone(draft))
  if (formation === null || formation === undefined) {
    return { status: 'no_formation', drafts: fallback, unavailablePlayerIds: [], error: null }
  }
  const parsed = parseSoccerTeamFormation(formation)
  if (!parsed.ok) {
    return { status: 'invalid', drafts: fallback, unavailablePlayerIds: [], error: parsed.error }
  }
  const template = getSoccerFormationTemplate(parsed.value.templateId)
  if (!template || template.playerCount !== maxOnFieldPlayers) {
    return {
      status: 'count_mismatch',
      drafts: fallback,
      unavailablePlayerIds: [],
      error: `The saved ${template?.playerCount ?? 'unknown'}-player formation does not match this ${maxOnFieldPlayers}-player match.`,
    }
  }

  const rosterIds = new Set<string>()
  for (const draft of drafts) {
    if (!draft.playerId) continue
    if (rosterIds.has(draft.playerId)) {
      return {
        status: 'invalid',
        drafts: fallback,
        unavailablePlayerIds: [],
        error: 'The active soccer roster contains a duplicate player id.',
      }
    }
    rosterIds.add(draft.playerId)
  }

  const slotByPlayerId = new Map<string, SoccerFormationSlotDefinition>()
  for (const definition of template.slots) {
    const playerId = parsed.value.assignments[definition.id]
    if (playerId) slotByPlayerId.set(playerId, definition)
  }
  const unavailablePlayerIds = unavailableSoccerFormationPlayerIds(
    parsed.value,
    rosterIds
  )
  const next = drafts.map(draft => {
    if (!draft.playerId) return structuredClone(draft)
    const assignedSlot = slotByPlayerId.get(draft.playerId)
    return {
      ...structuredClone(draft),
      selected: true,
      initialStatus: assignedSlot ? 'starter' as const : 'bench' as const,
      initialRole: assignedSlot
        ? { group: assignedSlot.roleGroup, label: null }
        : structuredClone(draft.initialRole),
    }
  })
  return {
    status: 'applied',
    drafts: next,
    unavailablePlayerIds,
    error: null,
  }
}

function hasExactKeys<T extends string>(
  value: unknown,
  expectedKeys: readonly T[]
): value is Record<T, unknown> {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length &&
    keys.every(key => expectedKeys.includes(key as T))
}

function invalid(error: string): SoccerFormationParseResult {
  return { ok: false, error }
}
