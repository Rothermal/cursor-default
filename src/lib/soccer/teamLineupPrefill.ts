import {
  applySoccerFormationToRosterDrafts,
  type SoccerFormationApplicationStatus,
  type SoccerFormationParticipantDraft,
} from './formation'
import {
  soccerLineupDefaultStatusForPlayer,
  unavailableSoccerLineupDefaultPlayerIds,
  type SoccerTeamLineupDefaultsV1,
} from './lineupDefaults'
import type { SoccerMatchLineupPresetV1 } from './types'

export type SoccerTeamLineupPrefillSource = 'formation' | 'lineup_defaults'
export type SoccerTeamLineupPrefillFormationStatus =
  | SoccerFormationApplicationStatus
  | 'unavailable_assignments'

export interface SoccerTeamLineupPrefillResult<TDraft> {
  source: SoccerTeamLineupPrefillSource
  drafts: TDraft[]
  formationStatus: SoccerTeamLineupPrefillFormationStatus
  formationError: string | null
  unavailableFormationPlayerIds: string[]
  unavailableLineupPlayerIds: string[]
}

export interface SoccerTeamLineupPrefillNotice {
  tone: 'info' | 'warning'
  message: string
}

export function soccerMatchLineupPresetFromPrefill<
  TDraft extends SoccerFormationParticipantDraft & { id: string },
>(
  result: SoccerTeamLineupPrefillResult<TDraft>
): SoccerMatchLineupPresetV1 {
  return {
    version: 1,
    source: result.source,
    entries: result.drafts.flatMap(draft =>
      draft.selected && draft.initialStatus === 'starter'
        ? [{ participantId: draft.id, role: structuredClone(draft.initialRole) }]
        : []
    ),
  }
}

export function pruneSoccerMatchLineupPreset(
  preset: SoccerMatchLineupPresetV1 | null,
  participantIds: Iterable<string>
): SoccerMatchLineupPresetV1 | null {
  if (!preset) return null
  const retained = new Set(participantIds)
  return {
    ...structuredClone(preset),
    entries: preset.entries
      .filter(entry => retained.has(entry.participantId))
      .map(entry => structuredClone(entry)),
  }
}

export function applySoccerTeamLineupPrefill<
  TDraft extends SoccerFormationParticipantDraft,
>(
  drafts: readonly TDraft[],
  options: {
    formation: unknown
    lineupDefaults: SoccerTeamLineupDefaultsV1
    maxOnFieldPlayers: number
  }
): SoccerTeamLineupPrefillResult<TDraft> {
  const formationResult = applySoccerFormationToRosterDrafts(
    drafts,
    options.formation,
    options.maxOnFieldPlayers
  )
  if (
    formationResult.status === 'applied' &&
    formationResult.unavailablePlayerIds.length === 0
  ) {
    return {
      source: 'formation',
      drafts: formationResult.drafts,
      formationStatus: formationResult.status,
      formationError: formationResult.error,
      unavailableFormationPlayerIds: formationResult.unavailablePlayerIds,
      unavailableLineupPlayerIds: [],
    }
  }

  const activePlayerIds = drafts.flatMap(draft => draft.playerId ? [draft.playerId] : [])
  return {
    source: 'lineup_defaults',
    drafts: drafts.map(draft => draft.playerId
      ? {
          ...structuredClone(draft),
          selected: true,
          initialStatus: soccerLineupDefaultStatusForPlayer(
            options.lineupDefaults,
            draft.playerId
          ),
        }
      : structuredClone(draft)
    ),
    formationStatus: formationResult.status === 'applied'
      ? 'unavailable_assignments'
      : formationResult.status,
    formationError: formationResult.status === 'applied'
      ? `The saved team formation includes ${formationResult.unavailablePlayerIds.length} unavailable ${formationResult.unavailablePlayerIds.length === 1 ? 'player' : 'players'}.`
      : formationResult.error,
    unavailableFormationPlayerIds: formationResult.unavailablePlayerIds,
    unavailableLineupPlayerIds: unavailableSoccerLineupDefaultPlayerIds(
      options.lineupDefaults,
      activePlayerIds
    ),
  }
}

export function soccerTeamLineupPrefillNotice(
  result: SoccerTeamLineupPrefillResult<unknown>,
  savedStarterCount: number
): SoccerTeamLineupPrefillNotice | null {
  if (result.source === 'formation') {
    return {
      tone: 'info',
      message: 'Team formation applied. Review the opening lineup before kickoff.',
    }
  }

  const unavailableCount = result.unavailableLineupPlayerIds.length
  const unavailableMessage = unavailableCount > 0
    ? ` ${unavailableCount} saved ${unavailableCount === 1 ? 'starter is' : 'starters are'} unavailable for this match.`
    : ''
  if (result.formationStatus !== 'no_formation') {
    return {
      tone: 'warning',
      message: `${result.formationError ?? 'The saved team formation is invalid.'} ${savedStarterCount > 0 ? 'Team lineup defaults' : 'Roster role defaults'} were used instead.${unavailableMessage} Repair the shared formation in Team Manage.`,
    }
  }
  return savedStarterCount > 0
    ? {
        tone: unavailableCount > 0 ? 'warning' : 'info',
        message: `Team lineup defaults applied. Review the opening lineup before kickoff.${unavailableMessage}`,
      }
    : null
}
