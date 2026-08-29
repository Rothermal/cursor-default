import { BASKETBALL_CLOCK_TEXT_MAX_LENGTH } from './clockEvents'
import {
  basketballSubstitutionRequiresReason,
  deriveBasketballLiveSubstitutionMode,
} from './lineupTransitions'
import type {
  BasketballMatchProjection,
  BasketballProjectedParticipant,
  BasketballSubstitutionMode,
  BasketballSubstitutionReasonCode,
  BasketballTeamSide,
} from './types'

export interface BasketballLineupSheetRow {
  participantId: string
  displayName: string
  number: string | null
  selected: boolean
  current: boolean
  entering: boolean
  leaving: boolean
  replacementRequired: boolean
  unavailableReason: string | null
}

export interface BasketballLineupSheetModel {
  teamSide: BasketballTeamSide
  current: BasketballLineupSheetRow[]
  bench: BasketballLineupSheetRow[]
  unavailable: BasketballLineupSheetRow[]
  resulting: BasketballLineupSheetRow[]
  resultingParticipantIds: string[]
  outgoingParticipantIds: string[]
  incomingParticipantIds: string[]
  mode: BasketballSubstitutionMode | null
  reasonRequired: boolean
  noteRequired: boolean
  changed: boolean
  canCommit: boolean
  validationMessage: string | null
}

export function basketballLineupInitialSelection(
  projection: BasketballMatchProjection,
  teamSide: BasketballTeamSide
): string[] {
  return [...(projection.lineup?.sides[teamSide]?.currentParticipantIds ?? [])]
}

export function buildBasketballLineupSheetModel(
  projection: BasketballMatchProjection,
  teamSide: BasketballTeamSide,
  participantIds: readonly string[],
  reasonCode: BasketballSubstitutionReasonCode | null,
  reasonNote: string,
  options: {
    allowUnchanged?: boolean
    substitutionMode?: BasketballSubstitutionMode
  } = {}
): BasketballLineupSheetModel {
  const side = projection.lineup?.sides[teamSide] ?? null
  const participants = Object.values(projection.participants)
    .filter(participant => participant.teamSide === teamSide)
  const participantById = new Map(participants.map(participant => [
    participant.participantId,
    participant,
  ]))
  const selected = new Set(participantIds)
  const currentIds = side?.currentParticipantIds ?? []
  const current = new Set(currentIds)
  const resultingParticipantIds = participants
    .filter(participant => selected.has(participant.participantId))
    .map(participant => participant.participantId)
  const resulting = new Set(resultingParticipantIds)
  const outgoingParticipantIds = currentIds.filter(id => !resulting.has(id))
  const incomingParticipantIds = resultingParticipantIds.filter(id => !current.has(id))
  const changed = outgoingParticipantIds.length > 0 || incomingParticipantIds.length > 0
  const mode = changed
    ? options.substitutionMode ?? deriveBasketballLiveSubstitutionMode(
        outgoingParticipantIds.length,
        incomingParticipantIds.length
      )
    : null
  const reasonRequired = Boolean(
    mode && basketballSubstitutionRequiresReason(mode, resultingParticipantIds.length)
  )
  const noteRequired = reasonCode === 'other'
  const unavailableSelected = resultingParticipantIds.find(id => {
    const participant = participantById.get(id)
    return participant ? unavailableReason(participant) !== null : true
  })

  let validationMessage: string | null = null
  if (!side) validationMessage = 'Lineup authority is unavailable for this side.'
  else if (participantIds.length !== selected.size) {
    validationMessage = 'A participant may appear in the resulting lineup only once.'
  } else if (participantIds.some(id => !participantById.has(id))) {
    validationMessage = 'The resulting lineup includes an unavailable participant.'
  } else if (resultingParticipantIds.length === 0) {
    validationMessage = 'Keep at least one participant on court.'
  } else if (resultingParticipantIds.length > 5) {
    validationMessage = 'A lineup may contain at most five participants.'
  } else if (unavailableSelected) {
    validationMessage = 'Remove every DNP, ejected, or disqualified participant from the result.'
  } else if (!changed && !options.allowUnchanged) {
    validationMessage = 'Change at least one participant before committing.'
  } else if (changed && !mode) {
    validationMessage = 'A swap must add and remove the same number of participants.'
  } else if (reasonRequired && !reasonCode) {
    validationMessage = 'Select a reason for this lineup transition.'
  } else if (!reasonCode && reasonNote.trim()) {
    validationMessage = 'Select a reason before adding a note.'
  } else if (noteRequired && !reasonNote.trim()) {
    validationMessage = 'Enter a note for the Other reason.'
  } else if (reasonNote.trim().length > BASKETBALL_CLOCK_TEXT_MAX_LENGTH) {
    validationMessage = `Keep the reason note within ${BASKETBALL_CLOCK_TEXT_MAX_LENGTH} characters.`
  }

  const row = (participant: BasketballProjectedParticipant): BasketballLineupSheetRow => ({
    participantId: participant.participantId,
    displayName: participant.displayName,
    number: participant.number,
    selected: selected.has(participant.participantId),
    current: current.has(participant.participantId),
    entering: !current.has(participant.participantId) && selected.has(participant.participantId),
    leaving: current.has(participant.participantId) && !selected.has(participant.participantId),
    replacementRequired: side?.replacementRequiredParticipantIds.includes(
      participant.participantId
    ) ?? false,
    unavailableReason: unavailableReason(participant),
  })

  return {
    teamSide,
    current: currentIds
      .map(id => participantById.get(id))
      .filter((participant): participant is BasketballProjectedParticipant => Boolean(participant))
      .map(row),
    bench: participants
      .filter(participant => !current.has(participant.participantId) && !unavailableReason(participant))
      .map(row),
    unavailable: participants
      .filter(participant => !current.has(participant.participantId) && unavailableReason(participant) !== null)
      .map(row),
    resulting: participants.filter(participant => resulting.has(participant.participantId)).map(row),
    resultingParticipantIds,
    outgoingParticipantIds,
    incomingParticipantIds,
    mode,
    reasonRequired,
    noteRequired,
    changed,
    canCommit: validationMessage === null,
    validationMessage,
  }
}

function unavailableReason(participant: BasketballProjectedParticipant): string | null {
  if (participant.ejected) return 'Ejected'
  if (participant.disqualified) return 'Disqualified'
  if (participant.openingStatus === 'dnp') return 'DNP'
  return null
}
