import { validateSoccerRole } from './rules'
import type {
  SoccerLineupEntry,
  SoccerMatchProjection,
  SoccerProjectedParticipant,
  SoccerRole,
} from './types'

export interface SoccerLineupTransitionDiff {
  enteringParticipantIds: string[]
  leavingParticipantIds: string[]
  retainedParticipantIds: string[]
  roleChanges: Array<{
    participantId: string
    from: SoccerRole
    to: SoccerRole
  }>
  substitutionCountDelta: number
  substitutionWindowCountDelta: number
}

export interface SoccerTargetLineupAnalysis {
  target: SoccerLineupEntry[]
  diff: SoccerLineupTransitionDiff
  halftime: boolean
  elapsedMs: number
}

export interface SoccerTargetLineupOptions {
  elapsedMs: number | null
  halftime: boolean
  requireStoppedClock: boolean
  requireDerivedHalftime: boolean
  rejectNoOp: boolean
}

export type SoccerTargetLineupAnalysisResult =
  | { ok: true; value: SoccerTargetLineupAnalysis }
  | { ok: false; message: string }

export function currentSoccerTargetLineup(
  projection: SoccerMatchProjection
): SoccerLineupEntry[] {
  return Object.values(projection.participants)
    .filter(participant => participant.status === 'on_field')
    .map(participant => ({
      participantId: participant.participantId,
      role: structuredClone(participant.role),
    }))
    .sort((left, right) => left.participantId.localeCompare(right.participantId))
}

export function isSoccerHalftimeBreak(projection: SoccerMatchProjection): boolean {
  const regulation = [...projection.currentRules.regulationSegments]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  if (
    projection.status !== 'period_break' ||
    projection.currentPeriodId !== null ||
    regulation.length < 2 ||
    regulation.length % 2 !== 0
  ) return false

  const midpoint = regulation.length / 2
  if (projection.completedPeriodIds.length !== midpoint) return false
  return regulation.slice(0, midpoint).every(
    (segment, index) => projection.completedPeriodIds[index] === segment.id
  )
}

export function analyzeSoccerTargetLineup(
  projection: SoccerMatchProjection,
  target: SoccerLineupEntry[],
  options: SoccerTargetLineupOptions
): SoccerTargetLineupAnalysisResult {
  if (projection.status !== 'in_progress' && projection.status !== 'period_break') {
    return { ok: false, message: 'Lineup transitions require an active match or period break.' }
  }
  if (options.requireStoppedClock && projection.clock.running) {
    return { ok: false, message: 'Pause the match clock before applying a lineup transition.' }
  }
  if (projection.status === 'in_progress' && options.elapsedMs === null) {
    return { ok: false, message: 'In-period lineup transitions require canonical elapsed time.' }
  }
  if (!projection.clock.running && options.elapsedMs !== projection.clock.elapsedMs) {
    return {
      ok: false,
      message: 'A stopped-clock lineup transition must use the current canonical elapsed time.',
    }
  }
  if (options.halftime && projection.status !== 'period_break') {
    return { ok: false, message: 'Halftime transitions can only be recorded during a period break.' }
  }
  const derivedHalftime = isSoccerHalftimeBreak(projection)
  if (options.requireDerivedHalftime && options.halftime !== derivedHalftime) {
    return { ok: false, message: 'The lineup transition halftime flag does not match match history.' }
  }
  if (!Array.isArray(target) || target.length === 0) {
    return { ok: false, message: 'A target lineup must include at least one participant.' }
  }

  if (target.some(entry => !entry || typeof entry.participantId !== 'string' || !entry.participantId || !validateSoccerRole(entry.role))) {
    return { ok: false, message: 'Every target-lineup entry requires a participant and valid role.' }
  }
  const targetIds = target.map(entry => entry.participantId)
  if (new Set(targetIds).size !== targetIds.length) {
    return { ok: false, message: 'A target lineup cannot repeat a participant.' }
  }
  for (const entry of target) {
    const participant = projection.participants[entry.participantId]
    if (!participant) {
      return { ok: false, message: `Target lineup references unknown participant ${entry.participantId}.` }
    }
    if (projection.participantDiscipline[entry.participantId]?.ejected) {
      return { ok: false, message: `${participant.displayName} is ejected and cannot return to the field.` }
    }
    if (
      participant.status !== 'on_field' &&
      participant.hasExited &&
      !projection.currentRules.allowReturnSubstitutions
    ) {
      return { ok: false, message: 'Return substitutions are disabled for this match.' }
    }
  }
  if (target.length > projection.currentRules.maxOnFieldPlayers) {
    return { ok: false, message: 'Lineup transition leaves too many players on field.' }
  }
  if (target.filter(entry => entry.role.group === 'goalkeeper').length !== 1) {
    return { ok: false, message: 'The tracked lineup must have exactly one goalkeeper.' }
  }

  const diff = diffSoccerTargetLineup(projection, target, options.halftime)
  const { enteringParticipantIds, leavingParticipantIds, retainedParticipantIds, roleChanges, substitutionCountDelta, substitutionWindowCountDelta } = diff
  const membershipChanged = enteringParticipantIds.length > 0 || leavingParticipantIds.length > 0
  const nextSubstitutionCount = projection.substitutionCount + substitutionCountDelta
  const nextWindowCount = projection.substitutionWindowCount + substitutionWindowCountDelta
  if (
    projection.currentRules.substitutionLimit !== null &&
    nextSubstitutionCount > projection.currentRules.substitutionLimit
  ) {
    return { ok: false, message: 'This lineup transition exceeds the configured match limit.' }
  }
  if (
    projection.currentRules.substitutionWindowLimit !== null &&
    nextWindowCount > projection.currentRules.substitutionWindowLimit
  ) {
    return { ok: false, message: 'This lineup transition exceeds the configured window limit.' }
  }
  if (options.rejectNoOp && !membershipChanged && roleChanges.length === 0) {
    return { ok: false, message: 'The target lineup does not change the current lineup.' }
  }

  return {
    ok: true,
    value: {
      target: target.map(entry => ({
        participantId: entry.participantId,
        role: structuredClone(entry.role),
      })),
      halftime: options.halftime,
      elapsedMs: options.elapsedMs ?? projection.clock.elapsedMs,
      diff: {
        enteringParticipantIds,
        leavingParticipantIds,
        retainedParticipantIds,
        roleChanges,
        substitutionCountDelta,
        substitutionWindowCountDelta,
      },
    },
  }
}

export function diffSoccerTargetLineup(projection: SoccerMatchProjection, target: SoccerLineupEntry[], halftime: boolean): SoccerLineupTransitionDiff {
  const current = new Map(currentSoccerTargetLineup(projection).map(entry => [entry.participantId, entry]))
  const desired = new Map(target.map(entry => [entry.participantId, entry]))
  const enteringParticipantIds = target.map(entry => entry.participantId).filter(participantId => !current.has(participantId))
  const leavingParticipantIds = [...current.keys()].filter(participantId => !desired.has(participantId))
  const retainedParticipantIds = target.map(entry => entry.participantId).filter(participantId => current.has(participantId))
  const roleChanges = retainedParticipantIds.flatMap(participantId => {
    const from = current.get(participantId)!.role
    const to = desired.get(participantId)!.role
    return sameRole(from, to)
      ? []
      : [{ participantId, from: structuredClone(from), to: structuredClone(to) }]
  })
  const membershipChanged = enteringParticipantIds.length > 0 || leavingParticipantIds.length > 0
  const substitutionCountDelta = enteringParticipantIds.length
  const substitutionWindowCountDelta = membershipChanged && !halftime ? 1 : 0
  return { enteringParticipantIds, leavingParticipantIds, retainedParticipantIds, roleChanges, substitutionCountDelta, substitutionWindowCountDelta }
}

export function applySoccerTargetLineup(
  projection: SoccerMatchProjection,
  target: SoccerLineupEntry[],
  options: SoccerTargetLineupOptions
): string | null {
  const analyzed = analyzeSoccerTargetLineup(projection, target, options)
  if (!analyzed.ok) return analyzed.message

  const { diff, elapsedMs } = analyzed.value
  for (const participantId of diff.leavingParticipantIds) {
    const participant = projection.participants[participantId]
    closeParticipantIntervals(participant, projection.currentPeriodId, elapsedMs)
    participant.status = 'left'
    participant.hasExited = true
  }
  for (const participantId of diff.enteringParticipantIds) {
    const participant = projection.participants[participantId]
    const entry = analyzed.value.target.find(item => item.participantId === participantId)!
    participant.status = 'on_field'
    participant.role = structuredClone(entry.role)
    participant.appearances = Math.max(1, participant.appearances)
    participant.activeSinceElapsedMs = projection.clock.running ? elapsedMs : null
    openParticipantIntervals(participant, projection.currentPeriodId, elapsedMs)
  }
  for (const change of diff.roleChanges) {
    const participant = projection.participants[change.participantId]
    closeRoleInterval(participant, projection.currentPeriodId, elapsedMs)
    participant.role = structuredClone(change.to)
    openRoleInterval(participant, projection.currentPeriodId, elapsedMs)
  }
  projection.substitutionCount += diff.substitutionCountDelta
  projection.substitutionWindowCount += diff.substitutionWindowCountDelta
  return null
}

function sameRole(left: SoccerRole, right: SoccerRole): boolean {
  return left.group === right.group && left.label === right.label
}

function closeParticipantIntervals(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (participant.activeSinceElapsedMs !== null) {
    participant.totalActiveMs += Math.max(0, elapsedMs - participant.activeSinceElapsedMs)
    participant.activeSinceElapsedMs = null
  }
  if (!periodId) return
  const onField = participant.onFieldIntervals[participant.onFieldIntervals.length - 1]
  if (onField && onField.periodId === periodId && onField.endElapsedMs === null) {
    onField.endElapsedMs = Math.max(onField.startElapsedMs, elapsedMs)
  }
  closeRoleInterval(participant, periodId, elapsedMs)
}

function openParticipantIntervals(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (!periodId) return
  const current = participant.onFieldIntervals[participant.onFieldIntervals.length - 1]
  if (!current || current.endElapsedMs !== null) {
    participant.onFieldIntervals.push({ periodId, startElapsedMs: elapsedMs, endElapsedMs: null })
  }
  openRoleInterval(participant, periodId, elapsedMs)
}

function closeRoleInterval(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (!periodId) return
  const current = participant.roleIntervals[participant.roleIntervals.length - 1]
  if (current && current.periodId === periodId && current.endElapsedMs === null) {
    current.endElapsedMs = Math.max(current.startElapsedMs, elapsedMs)
  }
}

function openRoleInterval(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (!periodId) return
  const current = participant.roleIntervals[participant.roleIntervals.length - 1]
  if (!current || current.endElapsedMs !== null) {
    participant.roleIntervals.push({
      periodId,
      startElapsedMs: elapsedMs,
      endElapsedMs: null,
      role: structuredClone(participant.role),
    })
  }
}
