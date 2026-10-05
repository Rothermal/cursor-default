import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { createHockeyUuid } from './id'
import { initializeHockeyEventGame, startHockeyGame, type HockeyCommandContext, type HockeyCommandResult } from './live'
import { defaultHockeyDressedAs, normalizeHockeyPosition, sortHockeyActors } from './positions'
import type { HockeyLineupDefaults } from './lineupDefaults'
import { findHockeyRulesProfile, DEFAULT_HOCKEY_PROFILE_ID, withExplicitHockeySuddenDeath } from './profiles'
import { HOCKEY_RULES_FIELDS } from './rules'
import { resolveHockeySettingsHierarchy } from './settings'
import { validateHockeyMatchSetup } from './setup'
import { hockeyLocalPlayerKey } from './stats'
import type { EventCloudPolicy } from '../eventCloudPolicy'
import type {
  HockeyAttackingDirection,
  HockeyClockModel,
  HockeyDressedAs,
  HockeyMatchRules,
  HockeyMatchSetup,
  HockeyProfileId,
  HockeyRuleOverrides,
  HockeyRuleSource,
  HockeyRulesField,
  HockeySettingsAuthority,
  HockeySettingsV1,
  HockeyTrackedTeam,
} from './types'
import { HOCKEY_SETUP_VERSION } from './types'

/** One roster row offered to setup: a cloud team player, or a quick local entry. */
export interface HockeySetupRosterPlayer {
  playerId: string | null
  displayName: string
  number: string | null
  position: string | null
}

export interface HockeySetupEntry extends HockeySetupRosterPlayer {
  /** Becomes the participant id when the entry is dressed. */
  id: string
  dressed: boolean
  dressedAs: HockeyDressedAs
}

/**
 * Personal or team settings the match starts from (HKY-5C). They apply only while the
 * draft uses their profile; another profile starts from its built-in rules.
 */
export interface HockeySetupSettingsLayer {
  authority: HockeySettingsAuthority
  settings: HockeySettingsV1
}

/**
 * The editable HKY-2E setup. Nothing here is saved: Start freezes it into setup v1, and
 * nothing is written back to personal or team settings.
 */
export interface HockeySetupDraft {
  trackedTeam: Exclude<HockeyTrackedTeam, 'neutral'>
  opponentName: string
  profileId: HockeyProfileId
  /** Match override; null keeps the settings' (or profile's) length. */
  periodLengthMinutes: number | null
  /** Match override; null keeps the settings' (or profile's) clock. */
  clockModel: HockeyClockModel | null
  settingsLayer: HockeySetupSettingsLayer | null
  /** The recorder changed the profile, length or clock; settings no longer pick the profile. */
  rulesEdited: boolean
  firstPeriodAttackingDirection: HockeyAttackingDirection
  entries: HockeySetupEntry[]
  goalieId: string | null
  starterIds: string[]
  opponentGoalieNumber: string
}

export const HOCKEY_SETUP_PERIOD_MINUTES = { min: 1, max: 30 } as const
const MAX_ENTRIES = 60

export function createHockeySetupDraft(roster: readonly HockeySetupRosterPlayer[] = []): HockeySetupDraft {
  return {
    trackedTeam: 'home',
    opponentName: '',
    profileId: DEFAULT_HOCKEY_PROFILE_ID,
    periodLengthMinutes: null,
    clockModel: null,
    settingsLayer: null,
    rulesEdited: false,
    firstPeriodAttackingDirection: 'left_to_right',
    entries: sortHockeyActors(roster.map(entryFromRoster)),
    goalieId: null,
    starterIds: [],
    opponentGoalieNumber: '',
  }
}

/** Replaces the roster (for example after choosing a team) and clears every lineup pick. */
export function setHockeyDraftRoster(draft: HockeySetupDraft, roster: readonly HockeySetupRosterPlayer[]): HockeySetupDraft {
  return { ...draft, entries: sortHockeyActors(roster.map(entryFromRoster)), goalieId: null, starterIds: [] }
}

/** Adds quick local entries; a blank name becomes "#number". */
export function addHockeyDraftPlayers(
  draft: HockeySetupDraft,
  players: readonly Omit<HockeySetupRosterPlayer, 'playerId'>[]
): HockeySetupDraft {
  const added = players
    .map(player => ({
      playerId: null,
      displayName: player.displayName.trim() || (player.number ? `#${player.number.trim()}` : ''),
      number: player.number?.trim() || null,
      position: normalizeHockeyPosition(player.position),
    }))
    .filter(player => player.displayName)
    .map(entryFromRoster)
  return { ...draft, entries: [...draft.entries, ...added].slice(0, MAX_ENTRIES) }
}

/** Parses "1, 7, 9 12" into jersey numbers for quick local entry. */
export function parseHockeyJerseyList(value: string): string[] {
  const numbers = value.split(/[\s,]+/).map(entry => entry.trim().replace(/^#/, '')).filter(Boolean)
  return [...new Set(numbers)].filter(number => number.length <= 10)
}

export function removeHockeyDraftEntry(draft: HockeySetupDraft, id: string): HockeySetupDraft {
  return withoutLineupPick({ ...draft, entries: draft.entries.filter(entry => entry.id !== id) }, id)
}

export function setHockeyEntryDressed(draft: HockeySetupDraft, id: string, dressed: boolean): HockeySetupDraft {
  const next = { ...draft, entries: draft.entries.map(entry => (entry.id === id ? { ...entry, dressed } : entry)) }
  return dressed ? next : withoutLineupPick(next, id)
}

/** Changing how a player dresses removes them from the opposite lineup slot. */
export function setHockeyEntryDressedAs(draft: HockeySetupDraft, id: string, dressedAs: HockeyDressedAs): HockeySetupDraft {
  const next = { ...draft, entries: draft.entries.map(entry => (entry.id === id ? { ...entry, dressedAs, dressed: true } : entry)) }
  return withoutLineupPick(next, id)
}

/** Picks the starting goalie; a skater is dressed as a goalie first. */
export function setHockeyDraftGoalie(draft: HockeySetupDraft, id: string | null): HockeySetupDraft {
  if (id === null) return { ...draft, goalieId: null }
  const dressed = setHockeyEntryDressedAs(draft, id, 'goalie')
  return { ...dressed, goalieId: id }
}

/** Toggles a starting skater, up to the rules' skaters per side. */
export function toggleHockeyDraftStarter(draft: HockeySetupDraft, id: string): HockeySetupDraft {
  if (draft.starterIds.includes(id)) return { ...draft, starterIds: draft.starterIds.filter(entry => entry !== id) }
  const limit = hockeyDraftRules(draft).skatersPerSide
  if (draft.starterIds.length >= limit) return draft
  const entry = draft.entries.find(candidate => candidate.id === id)
  if (!entry) return draft
  const dressed = entry.dressedAs === 'skater' && entry.dressed ? draft : setHockeyEntryDressedAs(draft, id, 'skater')
  return { ...dressed, starterIds: [...dressed.starterIds, id] }
}

/** Changing the profile keeps the direction and roster but drops overrides it may not fit. */
export function setHockeyDraftProfile(draft: HockeySetupDraft, profileId: HockeyProfileId): HockeySetupDraft {
  return withStarterLimit({ ...draft, profileId, periodLengthMinutes: null, clockModel: null, rulesEdited: true })
}

export function setHockeyDraftPeriodLength(draft: HockeySetupDraft, minutes: number | null): HockeySetupDraft {
  return { ...draft, periodLengthMinutes: minutes, rulesEdited: true }
}

export function setHockeyDraftClockModel(draft: HockeySetupDraft, clockModel: HockeyClockModel): HockeySetupDraft {
  return { ...draft, clockModel, rulesEdited: true }
}

/**
 * Starts the match from personal or team settings. Until the recorder edits the rules,
 * the draft also takes the settings' profile and drops its own length and clock picks.
 */
export function applyHockeySetupSettings(draft: HockeySetupDraft, layer: HockeySetupSettingsLayer | null): HockeySetupDraft {
  const next: HockeySetupDraft = { ...draft, settingsLayer: layer ? structuredClone(layer) : null }
  if (draft.rulesEdited) return withStarterLimit(next)
  return withStarterLimit({
    ...next,
    profileId: layer?.settings.baseProfile.profileId ?? DEFAULT_HOCKEY_PROFILE_ID,
    periodLengthMinutes: null,
    clockModel: null,
  })
}

/** Where each rule comes from before this match's own length and clock picks. */
export function hockeyDraftSettingsBase(draft: HockeySetupDraft): {
  rules: HockeyMatchRules
  sourceByField: Record<HockeyRulesField, HockeyRuleSource>
} {
  const layer = draft.settingsLayer
  if (layer && layer.settings.baseProfile.profileId === draft.profileId) {
    const resolved = resolveHockeySettingsHierarchy({
      authority: layer.authority,
      personalSettings: layer.authority === 'personal' ? layer.settings : undefined,
      teamSettings: layer.authority === 'team' ? layer.settings : undefined,
    })
    if (resolved.ok) return { rules: resolved.value.rules, sourceByField: resolved.value.sourceByField }
  }
  const profile = findHockeyRulesProfile(draft.profileId) ?? findHockeyRulesProfile(DEFAULT_HOCKEY_PROFILE_ID)!
  return {
    rules: withExplicitHockeySuddenDeath(structuredClone(profile.rules) as HockeyMatchRules),
    sourceByField: Object.fromEntries(HOCKEY_RULES_FIELDS.map(field => [field, 'built_in'])) as Record<HockeyRulesField, HockeyRuleSource>,
  }
}

/** The rules Start would freeze: the settings (or profile) with this match's overrides. */
export function hockeyDraftRules(draft: HockeySetupDraft): HockeyMatchRules {
  const base = hockeyDraftSettingsBase(draft).rules
  return withExplicitHockeySuddenDeath(structuredClone({ ...base, ...hockeyDraftOverrides(draft) }) as HockeyMatchRules)
}

export function hockeyDraftOverrides(draft: HockeySetupDraft): HockeyRuleOverrides {
  const base = hockeyDraftSettingsBase(draft).rules
  const overrides: HockeyRuleOverrides = {}
  const lengthMs = draft.periodLengthMinutes === null ? null : Math.round(draft.periodLengthMinutes * 60_000)
  if (lengthMs !== null && lengthMs !== base.regulation.periodLengthMs) {
    overrides.regulation = { ...base.regulation, periodLengthMs: lengthMs }
  }
  if (draft.clockModel !== null && draft.clockModel !== base.clockModel) {
    overrides.clockModel = draft.clockModel
    overrides.clock = draft.clockModel === 'none' ? null : { display: 'count_down', mode: 'stop_time' }
  }
  return overrides
}

export function hockeyDraftRulesSource(draft: HockeySetupDraft): Record<HockeyRulesField, HockeyRuleSource> {
  const base = hockeyDraftSettingsBase(draft).sourceByField
  const overridden = new Set(Object.keys(hockeyDraftOverrides(draft)))
  return Object.fromEntries(
    HOCKEY_RULES_FIELDS.map(field => [field, overridden.has(field) ? 'match' : base[field]])
  ) as Record<HockeyRulesField, HockeyRuleSource>
}

/**
 * Prefills the lineup from team defaults once a team roster loads (HKY-5C). Picks the
 * recorder already made win, so it changes nothing when any goalie or starter is chosen.
 * Default players missing from the active roster are counted, never guessed.
 */
export function prefillHockeyDraftLineup(
  draft: HockeySetupDraft,
  defaults: HockeyLineupDefaults
): { draft: HockeySetupDraft; missing: number } {
  if (draft.goalieId || draft.starterIds.length > 0) return { draft, missing: 0 }
  const byPlayer = new Map(draft.entries.flatMap(entry => (entry.playerId ? [[entry.playerId.toLowerCase(), entry.id] as const] : [])))
  let next = draft
  let missing = 0
  const entryFor = (playerId: string | null) => {
    if (!playerId) return null
    const id = byPlayer.get(playerId) ?? null
    if (!id) missing += 1
    return id
  }
  const starting = entryFor(defaults.startingGoaliePlayerId)
  if (starting) next = setHockeyDraftGoalie(next, starting)
  const backup = entryFor(defaults.backupGoaliePlayerId)
  if (backup) next = setHockeyEntryDressedAs(next, backup, 'goalie')
  for (const playerId of defaults.starterPlayerIds) {
    const id = entryFor(playerId)
    if (id) next = toggleHockeyDraftStarter(next, id)
  }
  return { draft: next, missing }
}

export type HockeySetupLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type HockeySetupTeamGate =
  | { ok: true; source: { teamId: string | null; seasonId: string | null } }
  | { ok: false; message: string }

/**
 * Whether Start may freeze the chosen team (PR #444 review). A selected team must resolve
 * to one of the recorder's Hockey teams and its own roster must have loaded; a selection
 * never falls back to a local setup silently. No selection is a local roster.
 */
export function hockeySetupTeamGate(input: {
  selectedTeamId: string
  teamsStatus: HockeySetupLoadStatus
  teams: readonly { id: string; seasonId: string | null }[]
  rosterStatus: HockeySetupLoadStatus
  rosterTeamId: string | null
}): HockeySetupTeamGate {
  if (!input.selectedTeamId) return { ok: true, source: { teamId: null, seasonId: null } }
  if (input.teamsStatus === 'error') {
    return { ok: false, message: 'Your teams could not load. Retry, or choose Local roster.' }
  }
  if (input.teamsStatus !== 'ready') return { ok: false, message: 'Your teams are still loading.' }
  const team = input.teams.find(entry => entry.id === input.selectedTeamId)
  if (!team) return { ok: false, message: 'That team is not one of your Hockey teams. Choose another team or Local roster.' }
  if (input.rosterStatus === 'error') {
    return { ok: false, message: 'The roster could not load. Retry, or choose Local roster.' }
  }
  if (input.rosterStatus !== 'ready' || input.rosterTeamId !== team.id) {
    return { ok: false, message: 'The roster is still loading.' }
  }
  return { ok: true, source: { teamId: team.id, seasonId: team.seasonId } }
}

export type HockeySetupBuildResult = { ok: true; setup: HockeyMatchSetup } | { ok: false; message: string }

/** Freezes the draft into setup v1; the message is suitable for the form. */
export function buildHockeyMatchSetup(
  draft: HockeySetupDraft,
  source: { teamId: string | null; seasonId: string | null }
): HockeySetupBuildResult {
  const length = draft.periodLengthMinutes
  if (
    length !== null &&
    (!Number.isInteger(length) || length < HOCKEY_SETUP_PERIOD_MINUTES.min || length > HOCKEY_SETUP_PERIOD_MINUTES.max)
  ) {
    return { ok: false, message: `Periods must be ${HOCKEY_SETUP_PERIOD_MINUTES.min} to ${HOCKEY_SETUP_PERIOD_MINUTES.max} whole minutes.` }
  }
  const dressed = draft.entries.filter(entry => entry.dressed)
  if (!draft.goalieId || !dressed.some(entry => entry.id === draft.goalieId)) {
    return { ok: false, message: 'Choose a starting goalie.' }
  }
  const opponentNumber = draft.opponentGoalieNumber.trim().replace(/^#/, '')
  if (opponentNumber.length > 10) return { ok: false, message: 'The opponent goalie number is too long.' }
  const setup: HockeyMatchSetup = {
    version: HOCKEY_SETUP_VERSION,
    trackedTeam: draft.trackedTeam,
    opponentName: draft.opponentName.trim().slice(0, 80) || null,
    sourceTeamId: source.teamId,
    sourceSeasonId: source.seasonId,
    rulesSnapshot: hockeyDraftRules(draft),
    rulesSource: hockeyDraftRulesSource(draft),
    firstPeriodAttackingDirection: draft.firstPeriodAttackingDirection,
    participants: dressed.map(entry => ({
      id: entry.id,
      playerId: entry.playerId,
      displayName: entry.displayName.slice(0, 80),
      number: entry.number,
      position: entry.position,
      dressedAs: entry.dressedAs,
    })),
    openingLineup: { goalieParticipantId: draft.goalieId, skaterParticipantIds: [...draft.starterIds] },
    opponentGoalie: {
      id: createHockeyUuid(),
      label: opponentNumber ? `#${opponentNumber}` : null,
      number: opponentNumber || null,
    },
  }
  const validation = validateHockeyMatchSetup(setup)
  return validation.ok ? { ok: true, setup } : { ok: false, message: validation.message }
}

/**
 * Builds a fresh local game, freezes the setup and starts period 1 (paused when the clock
 * is anchored). Local players get stable ids so the legacy player list stays consistent.
 */
export function createHockeyEventGameState(input: {
  sport: SportConfig
  setup: HockeyMatchSetup
  teamName: string
  opponentName: string
  date: string
  context: HockeyCommandContext
  /** HKY-5B: cloud games sync automatically; device games stay local until enabled. */
  cloudPolicy?: EventCloudPolicy
}): HockeyCommandResult {
  const initial = createInitialState()
  const base: GameState = {
    ...initial,
    cloudSync: { ...initial.cloudSync, eventCloudPolicy: input.cloudPolicy ?? 'local_only' },
    sport: input.sport,
    gameInfo: {
      teamName: input.teamName.trim() || 'Home',
      opponentName: input.opponentName.trim() || 'Opponent',
      tournamentName: '',
      tournamentId: null,
      date: input.date,
    },
    players: input.setup.participants.map(participant => ({
      id: hockeyLocalPlayerKey(participant),
      name: participant.displayName,
      number: participant.number ?? '',
      stats: {},
    })),
  }
  const initialized = initializeHockeyEventGame(base, input.setup)
  return initialized.ok ? startHockeyGame(initialized.state, input.context) : initialized
}

function entryFromRoster(player: HockeySetupRosterPlayer): HockeySetupEntry {
  const position = normalizeHockeyPosition(player.position)
  return {
    id: createHockeyUuid(),
    playerId: player.playerId,
    displayName: player.displayName,
    number: player.number?.trim() || null,
    position,
    dressed: true,
    dressedAs: defaultHockeyDressedAs(position),
  }
}

function withStarterLimit(draft: HockeySetupDraft): HockeySetupDraft {
  const limit = hockeyDraftRules(draft).skatersPerSide
  return draft.starterIds.length > limit ? { ...draft, starterIds: draft.starterIds.slice(0, limit) } : draft
}

function withoutLineupPick(draft: HockeySetupDraft, id: string): HockeySetupDraft {
  return {
    ...draft,
    goalieId: draft.goalieId === id ? null : draft.goalieId,
    starterIds: draft.starterIds.filter(entry => entry !== id),
  }
}
