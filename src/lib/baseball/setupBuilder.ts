import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { initializeBaseballEventGame, type BaseballCommandResult } from './commands'
import { createBaseballUuid } from './id'
import { normalizeBaseballPosition } from './positions'
import type { BaseballLineupDefaults } from './settings'
import { normalizeBaseballMatchSetup, validateBaseballMatchSetup } from './state'
import type { BaseballHomeAway, BaseballMatchRules, BaseballMatchSetup } from './types'

/** A roster player available to this game (cloud roster row or a locally entered player). */
export interface BaseballSetupRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
  position: string | null
}

export interface BaseballOpponentSlotDraft {
  label: string
  number: string
  position: string
}

/**
 * Editable setup state. Lineups use roster player ids; match participant ids are only
 * created when the setup is built, so editing never leaks half-made participants.
 */
export interface BaseballSetupDraft {
  trackedSide: BaseballHomeAway
  opponentName: string
  sourceTeamId: string | null
  sourceSeasonId: string | null
  rules: BaseballMatchRules
  /** Players dressed for this game (available as starters or substitutes). */
  selectedPlayerIds: string[]
  battingOrder: string[]
  /** Fielding number ('1'..'10') -> player id. */
  defense: Record<string, string>
  opponentSlots: BaseballOpponentSlotDraft[]
  opponentPitcher: { label: string; number: string }
}

export const DEFAULT_OPPONENT_SLOT_COUNT = 9

export function emptyOpponentSlots(count = DEFAULT_OPPONENT_SLOT_COUNT): BaseballOpponentSlotDraft[] {
  return Array.from({ length: count }, () => ({ label: '', number: '', position: '' }))
}

export function createBaseballSetupDraft(options: {
  rules: BaseballMatchRules
  roster: readonly BaseballSetupRosterPlayer[]
  lineupDefaults?: BaseballLineupDefaults | null
  sourceTeamId?: string | null
  sourceSeasonId?: string | null
  trackedSide?: BaseballHomeAway
  opponentName?: string
}): BaseballSetupDraft {
  const draft: BaseballSetupDraft = {
    trackedSide: options.trackedSide ?? 'home',
    opponentName: options.opponentName ?? '',
    sourceTeamId: options.sourceTeamId ?? null,
    sourceSeasonId: options.sourceSeasonId ?? null,
    rules: structuredClone(options.rules),
    selectedPlayerIds: options.roster.map(player => player.playerId),
    battingOrder: [],
    defense: {},
    opponentSlots: emptyOpponentSlots(),
    opponentPitcher: { label: '', number: '' },
  }
  return options.lineupDefaults ? applyBaseballLineupDefaults(draft, options.roster, options.lineupDefaults) : draft
}

/**
 * Copies team defaults into the draft once. Only players who are on this game's roster
 * are used; nothing is inferred for empty slots or positions.
 */
export function applyBaseballLineupDefaults(
  draft: BaseballSetupDraft,
  roster: readonly BaseballSetupRosterPlayer[],
  defaults: BaseballLineupDefaults
): BaseballSetupDraft {
  const available = new Set(roster.map(player => player.playerId.toLowerCase()))
  const byLower = new Map(roster.map(player => [player.playerId.toLowerCase(), player.playerId]))
  const resolve = (id: string) => (available.has(id.toLowerCase()) ? byLower.get(id.toLowerCase())! : null)
  const defense = Object.fromEntries(
    Object.entries(defaults.defense)
      .filter(([key]) => Number(key) <= draft.rules.defensivePlayers)
      .map(([key, id]) => [key, resolve(id)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null)
  )
  return {
    ...draft,
    battingOrder: defaults.battingOrder.map(resolve).filter((id): id is string => id !== null),
    defense,
  }
}

/** Players listed in the defaults who are not on this game's roster (shown as a warning). */
export function missingBaseballDefaultPlayers(
  roster: readonly BaseballSetupRosterPlayer[],
  defaults: BaseballLineupDefaults
): string[] {
  const available = new Set(roster.map(player => player.playerId.toLowerCase()))
  return [...new Set([...defaults.battingOrder, ...Object.values(defaults.defense)])]
    .filter(id => !available.has(id.toLowerCase()))
}

/** Removing a player from the game also removes them from the lineup. */
export function setBaseballPlayerSelected(draft: BaseballSetupDraft, playerId: string, selected: boolean): BaseballSetupDraft {
  if (selected) {
    return draft.selectedPlayerIds.includes(playerId)
      ? draft
      : { ...draft, selectedPlayerIds: [...draft.selectedPlayerIds, playerId] }
  }
  return {
    ...draft,
    selectedPlayerIds: draft.selectedPlayerIds.filter(id => id !== playerId),
    battingOrder: draft.battingOrder.filter(id => id !== playerId),
    defense: Object.fromEntries(Object.entries(draft.defense).filter(([, id]) => id !== playerId)),
  }
}

/** Assigns a player to a position, moving them off any other position. Empty id clears it. */
export function setBaseballDraftFielder(draft: BaseballSetupDraft, position: number, playerId: string): BaseballSetupDraft {
  const defense = Object.fromEntries(
    Object.entries(draft.defense).filter(([key, id]) => key !== String(position) && id !== playerId)
  )
  if (playerId) defense[String(position)] = playerId
  return { ...draft, defense: sortDefense(defense) }
}

/** A rules change can drop the short fielder; positions beyond the new count are cleared. */
export function setBaseballDraftRules(draft: BaseballSetupDraft, rules: BaseballMatchRules): BaseballSetupDraft {
  return {
    ...draft,
    rules: structuredClone(rules),
    defense: Object.fromEntries(Object.entries(draft.defense).filter(([key]) => Number(key) <= rules.defensivePlayers)),
  }
}

export type BaseballSetupBuildResult =
  | { ok: true; setup: BaseballMatchSetup }
  | { ok: false; message: string }

/** Builds the immutable BSB-1 setup snapshot from the draft and checks it. */
export function buildBaseballMatchSetup(
  draft: BaseballSetupDraft,
  roster: readonly BaseballSetupRosterPlayer[],
  createId: () => string = createBaseballUuid
): BaseballSetupBuildResult {
  const selected = roster.filter(player => draft.selectedPlayerIds.includes(player.playerId))
  const participantIdByPlayer = new Map(selected.map(player => [player.playerId, createId()]))
  const participantFor = (playerId: string) => participantIdByPlayer.get(playerId)
  const lineupPlayers = [...draft.battingOrder, ...Object.values(draft.defense)]
  if (lineupPlayers.some(id => !participantFor(id))) {
    return { ok: false, message: 'The lineup names a player who is not dressed for this game.' }
  }
  const slotCount = draft.opponentSlots.length
  if (slotCount < 1 || slotCount > 30) return { ok: false, message: 'The opponent needs between 1 and 30 batting slots.' }
  const setup: BaseballMatchSetup = {
    version: 1,
    trackedSide: draft.trackedSide,
    opponentName: blankToNull(draft.opponentName),
    sourceTeamId: draft.sourceTeamId,
    sourceSeasonId: draft.sourceSeasonId,
    rulesSnapshot: structuredClone(draft.rules),
    participants: selected.map(player => ({
      id: participantFor(player.playerId)!,
      playerId: player.playerId,
      displayName: (player.displayName.trim() || 'Player').slice(0, 80),
      number: blankToNull(player.number ?? '', 10),
      position: normalizeBaseballPosition(player.position),
      bats: null,
      throws: null,
    })),
    trackedLineup: {
      battingOrder: draft.battingOrder.map(id => participantFor(id)!),
      defense: Object.fromEntries(Object.entries(draft.defense).map(([key, id]) => [key, participantFor(id)!])),
    },
    opponentSlots: draft.opponentSlots.map(slot => ({
      id: createId(),
      label: blankToNull(slot.label),
      number: blankToNull(slot.number, 10),
      position: normalizeBaseballPosition(slot.position),
      bats: null,
    })),
    opponentPitcher: {
      id: createId(),
      label: blankToNull(draft.opponentPitcher.label),
      number: blankToNull(draft.opponentPitcher.number, 10),
      throws: null,
    },
  }
  const validation = validateBaseballMatchSetup(setup)
  if (!validation.ok) return { ok: false, message: validation.message }
  // The saved game must survive reload, so the snapshot has to pass the strict reader too.
  if (!normalizeBaseballMatchSetup(setup)) return { ok: false, message: 'Some player details are too long or invalid.' }
  return { ok: true, setup }
}

/**
 * Assembles a fresh local game (game info plus players whose ids match the participants)
 * and installs the frozen setup with an empty event stream. The game is not started.
 */
export function createBaseballEventGameState(input: {
  sport: SportConfig
  setup: BaseballMatchSetup
  teamName: string
  date: string
}): BaseballCommandResult {
  const base: GameState = {
    ...createInitialState(),
    sport: input.sport,
    gameInfo: {
      teamName: input.teamName.trim().slice(0, 80) || 'Home',
      opponentName: input.setup.opponentName ?? 'Opponent',
      tournamentName: '',
      tournamentId: null,
      date: input.date,
    },
    players: input.setup.participants.map(participant => ({
      id: participant.playerId ?? participant.id,
      name: participant.displayName,
      number: participant.number ?? '',
      stats: {},
    })),
  }
  return initializeBaseballEventGame(base, input.setup)
}

function sortDefense(defense: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(defense).sort(([left], [right]) => Number(left) - Number(right)))
}

function blankToNull(value: string, maxLength = 80): string | null {
  const trimmed = value.trim().slice(0, maxLength).trim()
  return trimmed || null
}
