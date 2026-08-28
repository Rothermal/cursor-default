import type { GameState, SportConfig } from '../../types'
import { gameReducer, createInitialState } from '../gameReducer'
import { stableJson } from '../gameEvents/stream'
import { setBasketballEventCreationIntent } from './commands'
import { createBasketballUuid } from './id'
import { BASKETBALL_RULE_FIELDS } from './profileDiffPresentation'
import {
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
  parseBasketballPersonalSettings,
  parseBasketballTeamSettings,
  resolveBasketballSettingsHierarchy,
  type BasketballPersonalSettingsV1,
  type BasketballTeamSettingsV1,
} from './settings'
import {
  isBasketballStructuredMatchRules,
  normalizeBasketballMatchRules,
  normalizeBasketballRulesSource,
} from './rules'
import { normalizeBasketballRuleOverrides } from './profiles'
import type {
  BasketballMatchRulesV2,
  BasketballMatchRulesV3,
  BasketballMatchParticipant,
  BasketballOpeningLineups,
  BasketballRuleOverrides,
  BasketballRulesField,
  BasketballRulesSource,
} from './types'

const STORAGE_KEY_PREFIX = 'statkeeper_basketball_setup_draft:'

export type BasketballSetupAccountScope = 'anonymous' | `user:${string}`
export type BasketballSetupAuthority = 'legacy' | 'sport_events'
export type BasketballSetupAccessRole = 'owner' | 'admin' | 'scorer'

export type BasketballSetupSource =
  | {
      kind: 'personal'
      teamName: string
      seasonId: string | null
      seasonName: string
    }
  | {
      kind: 'team'
      teamId: string
      seasonId: string
      teamName: string
      seasonName: string
      accessRole: BasketballSetupAccessRole
    }

export interface BasketballSetupDraftEventV1 {
  settingsAuthority:
    | {
        kind: 'personal'
        revision: number | null
        settings: BasketballPersonalSettingsV1
      }
    | {
        kind: 'team'
        revision: number | null
        settings: BasketballTeamSettingsV1
      }
  matchOverrides: BasketballRuleOverrides
  reviewedRules: BasketballMatchRulesV2 | BasketballMatchRulesV3
  reviewedRulesSource: BasketballRulesSource
  cloudIntent: 'automatic' | 'local_only'
}

export type BasketballSetupAuthoritySnapshot =
  | {
      kind: 'personal'
      revision: number | null
      settings: BasketballPersonalSettingsV1
    }
  | {
      kind: 'team'
      revision: number | null
      settings: BasketballTeamSettingsV1
    }

export type BasketballSetupEventRefreshResult =
  | { ok: true; event: BasketballSetupDraftEventV1 }
  | { ok: false; error: string }

export interface BasketballSetupDraftV1 {
  version: 1
  draftId: string
  accountScope: BasketballSetupAccountScope
  createdAt: string
  updatedAt: string
  source: BasketballSetupSource
  authority: BasketballSetupAuthority
  gameInfo: {
    opponentName: string
    tournamentMode: 'none' | 'existing' | 'new' | 'text'
    tournamentId: string | null
    tournamentName: string
    tournamentUrl: string | null
    date: string
  }
  display: {
    defaultCourtFlipped: boolean
  }
  event: BasketballSetupDraftEventV1 | null
  legacyTeamStatsConfig: Record<string, unknown> | null
  committedLocalGameId: string | null
}

export type BasketballSetupPlayerStep = 'roster' | 'opening_lineup' | 'review'
export type BasketballSetupParticipantStatus = 'starter' | 'bench' | 'dnp'

export interface BasketballSetupDraftParticipantV2 {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  teamSide: 'tracked' | 'opponent'
  initialStatus: BasketballSetupParticipantStatus
}

export interface BasketballSetupDraftLineupV2 {
  participantIds: string[]
  shortHandedReason: string | null
}

export interface BasketballSetupDraftPlayerProgressV2 {
  currentStep: BasketballSetupPlayerStep
  participants: BasketballSetupDraftParticipantV2[]
  openingLineups: {
    tracked: BasketballSetupDraftLineupV2
    opponent: BasketballSetupDraftLineupV2 | null
  }
}

export interface BasketballSetupDraftV2 extends Omit<BasketballSetupDraftV1, 'version'> {
  version: 2
  playerSetup: BasketballSetupDraftPlayerProgressV2
}

export type BasketballSetupDraft = BasketballSetupDraftV1 | BasketballSetupDraftV2

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type BasketballSetupDraftParseResult =
  | { ok: true; value: BasketballSetupDraft }
  | { ok: false; error: string }

export function basketballSetupAccountScope(
  userId: string | null
): BasketballSetupAccountScope {
  return userId ? `user:${userId}` : 'anonymous'
}

export function basketballSetupDraftKey(scope: BasketballSetupAccountScope): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(scope)}`
}

export function createBasketballSetupDraft({
  accountScope,
  source,
  now = new Date(),
}: {
  accountScope: BasketballSetupAccountScope
  source: BasketballSetupSource
  now?: Date
}): BasketballSetupDraftV2 {
  const timestamp = now.toISOString()
  return {
    version: 2,
    draftId: createDraftId(),
    accountScope,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: structuredClone(source),
    authority: 'legacy',
    gameInfo: {
      opponentName: '',
      tournamentMode: 'none',
      tournamentId: null,
      tournamentName: '',
      tournamentUrl: null,
      date: timestamp.slice(0, 10),
    },
    display: { defaultCourtFlipped: false },
    event: null,
    legacyTeamStatsConfig: null,
    committedLocalGameId: null,
    playerSetup: emptyBasketballSetupPlayerProgress(),
  }
}

export function createBasketballSetupDraftEvent({
  authority,
  revision,
  settings,
  cloudIntent,
  matchOverrides = {},
}: {
  authority: 'personal' | 'team'
  revision: number | null
  settings: BasketballPersonalSettingsV1 | BasketballTeamSettingsV1
  cloudIntent: 'automatic' | 'local_only'
  matchOverrides?: BasketballRuleOverrides
}): BasketballSetupDraftEventV1 | null {
  const resolution = resolveBasketballSettingsHierarchy({
    authority,
    personalSettings:
      authority === 'personal' ? settings : DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
    teamSettings: authority === 'team' ? settings : DEFAULT_BASKETBALL_TEAM_SETTINGS,
    matchOverrides,
  })
  if (!resolution.ok) return null
  if (!isBasketballStructuredMatchRules(resolution.value.rules)) return null
  const baseProfile = settings.baseProfile
  return {
    settingsAuthority: authority === 'personal'
      ? {
          kind: 'personal',
          revision,
          settings: structuredClone(settings as BasketballPersonalSettingsV1),
        }
      : {
          kind: 'team',
          revision,
          settings: structuredClone(settings as BasketballTeamSettingsV1),
        },
    matchOverrides: structuredClone(matchOverrides),
    reviewedRules: structuredClone(resolution.value.rules),
    reviewedRulesSource: {
      profileId: baseProfile.profileId,
      profileVersion: baseProfile.profileVersion,
      personalRevision: authority === 'personal' ? revision : null,
      teamRevision: authority === 'team' ? revision : null,
      hasExplicitMatchOverrides: resolution.value.customized,
    },
    cloudIntent,
  }
}

export function basketballSetupEventMatchesAuthority(
  event: BasketballSetupDraftEventV1,
  authority: BasketballSetupAuthoritySnapshot
): boolean {
  return event.settingsAuthority.kind === authority.kind &&
    event.settingsAuthority.revision === authority.revision &&
    stableJson(event.settingsAuthority.settings) === stableJson(authority.settings)
}

export function refreshBasketballSetupDraftEvent(
  event: BasketballSetupDraftEventV1,
  authority: BasketballSetupAuthoritySnapshot
): BasketballSetupEventRefreshResult {
  if (event.settingsAuthority.kind !== authority.kind) {
    return { ok: false, error: 'Basketball rules authority no longer matches this setup.' }
  }
  const refreshed = createBasketballSetupDraftEvent({
    authority: authority.kind,
    revision: authority.revision,
    settings: authority.settings,
    matchOverrides: event.matchOverrides,
    cloudIntent: event.cloudIntent,
  })
  return refreshed
    ? { ok: true, event: refreshed }
    : {
        ok: false,
        error: 'Match overrides are incompatible with the refreshed Basketball defaults.',
      }
}

export function basketballSetupRuleDifferences(
  current: BasketballMatchRulesV2 | BasketballMatchRulesV3,
  candidate: BasketballMatchRulesV2 | BasketballMatchRulesV3
): BasketballRulesField[] {
  return BASKETBALL_RULE_FIELDS.filter(
    field => stableJson(ruleFieldValue(current, field)) !== stableJson(ruleFieldValue(candidate, field))
  )
}

export function parseBasketballSetupDraft(
  value: unknown,
  expectedScope?: BasketballSetupAccountScope
): BasketballSetupDraftParseResult {
  const commonKeys = [
    'version',
    'draftId',
    'accountScope',
    'createdAt',
    'updatedAt',
    'source',
    'authority',
    'gameInfo',
    'display',
    'event',
    'legacyTeamStatsConfig',
    'committedLocalGameId',
  ]
  if (!isPlainObject(value) ||
      (value.version !== 1 && value.version !== 2) ||
      !hasExactKeys(value, value.version === 2 ? [...commonKeys, 'playerSetup'] : commonKeys)) {
    return invalid('Basketball setup draft fields are invalid.')
  }
  if (!isNonEmptyString(value.draftId)) return invalid('Basketball setup draft id is invalid.')
  if (!isAccountScope(value.accountScope)) return invalid('Basketball setup account scope is invalid.')
  if (expectedScope && value.accountScope !== expectedScope) {
    return invalid('Basketball setup draft belongs to another account.')
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    return invalid('Basketball setup draft timestamps are invalid.')
  }
  const source = parseSource(value.source)
  if (!source) return invalid('Basketball setup source is invalid.')
  if (value.authority !== 'legacy' && value.authority !== 'sport_events') {
    return invalid('Basketball setup authority is invalid.')
  }
  const gameInfo = parseGameInfo(value.gameInfo)
  if (!gameInfo) return invalid('Basketball setup game information is invalid.')
  if (!hasExactKeys(value.display, ['defaultCourtFlipped']) ||
      typeof value.display.defaultCourtFlipped !== 'boolean') {
    return invalid('Basketball setup display preference is invalid.')
  }
  const event = value.event === null ? null : parseEvent(value.event)
  if (value.event !== null && !event) return invalid('Basketball setup event review is invalid.')
  if ((value.authority === 'legacy') !== (event === null)) {
    return invalid('Basketball setup authority and event review do not match.')
  }
  if (event && event.settingsAuthority.kind !== source.kind) {
    return invalid('Basketball setup rules authority does not match its source.')
  }
  const legacyTeamStatsConfig = value.legacyTeamStatsConfig === null
    ? null
    : isPlainObject(value.legacyTeamStatsConfig)
      ? structuredClone(value.legacyTeamStatsConfig)
      : undefined
  if (legacyTeamStatsConfig === undefined) {
    return invalid('Basketball setup legacy team configuration is invalid.')
  }
  if (!isNullableNonEmptyString(value.committedLocalGameId)) {
    return invalid('Basketball setup committed game id is invalid.')
  }
  const playerSetup = value.version === 2 ? parsePlayerSetup(value.playerSetup) : null
  if (value.version === 2 && !playerSetup) {
    return invalid('Basketball setup player progress is invalid.')
  }
  const common = {
    draftId: value.draftId,
    accountScope: value.accountScope,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    source,
    authority: value.authority,
    gameInfo,
    display: { defaultCourtFlipped: value.display.defaultCourtFlipped },
    event,
    legacyTeamStatsConfig,
    committedLocalGameId: value.committedLocalGameId,
  }
  return {
    ok: true,
    value: value.version === 1
      ? structuredClone({ version: 1, ...common } as BasketballSetupDraftV1)
      : structuredClone({ version: 2, ...common, playerSetup: playerSetup! } as BasketballSetupDraftV2),
  }
}

export function upgradeBasketballSetupDraftToV2(
  draft: BasketballSetupDraft
): BasketballSetupDraftV2 {
  if (draft.version === 2) return structuredClone(draft)
  return {
    ...structuredClone(draft),
    version: 2,
    playerSetup: emptyBasketballSetupPlayerProgress(),
  }
}

export interface BasketballSetupTrackedRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
}

export type BasketballSetupProgressResult =
  | { ok: true; draft: BasketballSetupDraftV2 }
  | { ok: false; error: string }

export function reconcileBasketballSetupTrackedRoster(
  draft: BasketballSetupDraft,
  roster: BasketballSetupTrackedRosterPlayer[],
  now = new Date()
): BasketballSetupDraftV2 {
  const upgraded = upgradeBasketballSetupDraftToV2(draft)
  const existingTracked = new Map(
    upgraded.playerSetup.participants
      .filter(participant => participant.teamSide === 'tracked' && participant.playerId)
      .map(participant => [participant.playerId!, participant])
  )
  const tracked = roster.map(player => {
    const existing = existingTracked.get(player.playerId)
    return {
      participantId: existing?.participantId ?? createBasketballUuid(),
      playerId: player.playerId,
      displayName: player.displayName.trim(),
      number: player.number?.trim() || null,
      teamSide: 'tracked' as const,
      initialStatus: existing?.initialStatus ?? 'bench' as const,
    }
  })
  const opponents = upgraded.playerSetup.participants.filter(
    participant => participant.teamSide === 'opponent'
  )
  const starterIds = tracked
    .filter(participant => participant.initialStatus === 'starter')
    .map(participant => participant.participantId)
  const priorReason = upgraded.playerSetup.openingLineups.tracked.shortHandedReason
  const shortHandedReason = starterIds.length > 0 && starterIds.length < 5
    ? priorReason
    : null
  return {
    ...upgraded,
    updatedAt: now.toISOString(),
    playerSetup: {
      ...upgraded.playerSetup,
      participants: [...tracked, ...opponents],
      openingLineups: {
        ...upgraded.playerSetup.openingLineups,
        tracked: { participantIds: starterIds, shortHandedReason },
      },
    },
  }
}

export function updateBasketballSetupTrackedStatus(
  draft: BasketballSetupDraft,
  participantId: string,
  status: BasketballSetupParticipantStatus,
  now = new Date()
): BasketballSetupProgressResult {
  const upgraded = upgradeBasketballSetupDraftToV2(draft)
  const target = upgraded.playerSetup.participants.find(
    participant => participant.participantId === participantId && participant.teamSide === 'tracked'
  )
  if (!target) return { ok: false, error: 'The selected Basketball participant is unavailable.' }
  const starterCount = upgraded.playerSetup.participants.filter(
    participant => participant.teamSide === 'tracked' && participant.initialStatus === 'starter'
  ).length
  if (status === 'starter' && target.initialStatus !== 'starter' && starterCount >= 5) {
    return { ok: false, error: 'An opening Basketball lineup cannot contain more than five players.' }
  }
  const participants = upgraded.playerSetup.participants.map(participant =>
    participant.participantId === participantId
      ? { ...participant, initialStatus: status }
      : participant
  )
  const participantIds = participants
    .filter(participant =>
      participant.teamSide === 'tracked' && participant.initialStatus === 'starter'
    )
    .map(participant => participant.participantId)
  return {
    ok: true,
    draft: {
      ...upgraded,
      updatedAt: now.toISOString(),
      playerSetup: {
        ...upgraded.playerSetup,
        participants,
        openingLineups: {
          ...upgraded.playerSetup.openingLineups,
          tracked: {
            participantIds,
            shortHandedReason: participantIds.length === 5
              ? null
              : upgraded.playerSetup.openingLineups.tracked.shortHandedReason,
          },
        },
      },
    },
  }
}

export function confirmBasketballSetupOpeningLineup(
  draft: BasketballSetupDraft,
  shortHandedReason: string,
  now = new Date()
): BasketballSetupProgressResult {
  const upgraded = upgradeBasketballSetupDraftToV2(draft)
  const participantIds = upgraded.playerSetup.openingLineups.tracked.participantIds
  if (participantIds.length === 0) {
    return { ok: false, error: 'Select at least one Basketball starter.' }
  }
  if (participantIds.length > 5) {
    return { ok: false, error: 'An opening Basketball lineup cannot contain more than five players.' }
  }
  const reason = shortHandedReason.trim()
  if (participantIds.length < 5 && !reason) {
    return { ok: false, error: 'Explain why this Basketball team will start short-handed.' }
  }
  const candidate: BasketballSetupDraftV2 = {
    ...upgraded,
    updatedAt: now.toISOString(),
    playerSetup: {
      ...upgraded.playerSetup,
      currentStep: 'review',
      openingLineups: {
        ...upgraded.playerSetup.openingLineups,
        tracked: {
          participantIds: [...participantIds],
          shortHandedReason: participantIds.length < 5 ? reason : null,
        },
      },
    },
  }
  const parsed = parseBasketballSetupDraft(candidate, candidate.accountScope)
  return parsed.ok && parsed.value.version === 2
    ? { ok: true, draft: parsed.value }
    : { ok: false, error: parsed.ok ? 'Basketball lineup review is invalid.' : parsed.error }
}

export function basketballVersion3StartSetupFromDraft(
  draft: BasketballSetupDraft,
  anchored: boolean
): { participants: BasketballMatchParticipant[]; openingLineups: BasketballOpeningLineups | null } | null {
  if (draft.version !== 2 || (anchored && draft.playerSetup.currentStep !== 'review')) return null
  const participants: BasketballMatchParticipant[] = draft.playerSetup.participants.map(
    participant => ({
      id: participant.participantId,
      playerId: participant.playerId,
      displayName: participant.displayName,
      number: participant.number,
      teamSide: participant.teamSide,
      initialStatus: anchored ? participant.initialStatus : 'bench',
      position: null,
      captain: false,
    })
  )
  return {
    participants,
    openingLineups: anchored
      ? {
          tracked: {
            participantIds: [...draft.playerSetup.openingLineups.tracked.participantIds],
            shortHandedReason: draft.playerSetup.openingLineups.tracked.shortHandedReason,
          },
          opponent: draft.playerSetup.openingLineups.opponent
            ? {
                participantIds: [...draft.playerSetup.openingLineups.opponent.participantIds],
                shortHandedReason: draft.playerSetup.openingLineups.opponent.shortHandedReason,
              }
            : null,
        }
      : null,
  }
}

export function loadBasketballSetupDraft(
  scope: BasketballSetupAccountScope,
  storage: StorageLike = localStorage
): BasketballSetupDraft | null {
  const key = basketballSetupDraftKey(scope)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = parseBasketballSetupDraft(JSON.parse(raw), scope)
    if (parsed.ok) return parsed.value
    storage.removeItem(key)
    return null
  } catch {
    return null
  }
}

export function saveBasketballSetupDraft(
  draft: BasketballSetupDraft,
  storage: StorageLike = localStorage
): BasketballSetupDraftParseResult {
  const parsed = parseBasketballSetupDraft(draft, draft.accountScope)
  if (!parsed.ok) return parsed
  try {
    storage.setItem(
      basketballSetupDraftKey(draft.accountScope),
      JSON.stringify(parsed.value)
    )
    return parsed
  } catch {
    return invalid('Basketball setup draft could not be saved on this device.')
  }
}

export function clearBasketballSetupDraft(
  scope: BasketballSetupAccountScope,
  storage: StorageLike = localStorage
): void {
  storage.removeItem(basketballSetupDraftKey(scope))
}

export function basketballSetupDraftMatchesRoute(
  draft: BasketballSetupDraft,
  requestedTeamId: string | null
): boolean {
  return requestedTeamId
    ? draft.source.kind === 'team' && draft.source.teamId === requestedTeamId
    : draft.source.kind === 'personal'
}

export function resolveBasketballSetupRosterTeamId({
  cloudTeamId,
  draft,
  activeLocalGameId,
}: {
  cloudTeamId: string | null
  draft: BasketballSetupDraft | null
  activeLocalGameId: string | null
}): string | null {
  if (cloudTeamId) return cloudTeamId
  if (
    !draft?.event ||
    draft.authority !== 'sport_events' ||
    draft.event.cloudIntent !== 'local_only' ||
    draft.source.kind !== 'team' ||
    !activeLocalGameId ||
    draft.committedLocalGameId !== activeLocalGameId
  ) {
    return null
  }
  return draft.source.teamId
}

export function basketballSetupDraftHasMeaningfulEdits(
  draft: BasketballSetupDraft
): boolean {
  return Boolean(
    draft.committedLocalGameId ||
    draft.authority === 'sport_events' ||
    draft.source.teamName.trim() ||
    draft.gameInfo.opponentName.trim() ||
    draft.gameInfo.tournamentName.trim()
  )
}

export function buildBasketballSetupGameState({
  draft,
  sport,
  cloudStatus,
}: {
  draft: BasketballSetupDraft
  sport: SportConfig
  cloudStatus: GameState['cloudSync']['status']
}): { ok: true; state: GameState } | { ok: false; error: string } {
  const parsed = parseBasketballSetupDraft(draft, draft.accountScope)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (sport.id !== 'basketball') {
    return { ok: false, error: 'Basketball setup requires the Basketball sport.' }
  }
  const current = parsed.value
  if (!current.source.teamName.trim() || !current.gameInfo.opponentName.trim()) {
    return { ok: false, error: 'Team and opponent are required.' }
  }
  let state = gameReducer(createInitialState(cloudStatus), { type: 'SET_SPORT', sport })
  if (current.authority === 'sport_events') {
    const intent = setBasketballEventCreationIntent(state, true)
    if (!intent.ok) return { ok: false, error: intent.message }
    state = intent.state
  }
  state = gameReducer(state, {
    type: 'SET_TEAM_STATS_CONFIG',
    config: current.legacyTeamStatsConfig,
  })
  state = {
    ...state,
    basketballCourtOrientation: current.display.defaultCourtFlipped ? 'flipped' : 'standard',
  }
  state = gameReducer(state, {
    type: 'SET_CLOUD_SYNC_STATE',
    cloudSync: {
      ...(current.authority === 'sport_events'
        ? { eventCloudPolicy: current.event!.cloudIntent }
        : {}),
      seasonId:
        current.authority === 'sport_events' && current.event!.cloudIntent === 'local_only'
          ? null
          : current.source.seasonId,
      teamId:
        current.authority === 'sport_events' && current.event!.cloudIntent === 'local_only'
          ? null
          : current.source.kind === 'team'
            ? current.source.teamId
            : null,
    },
  })
  state = gameReducer(state, {
    type: 'SET_GAME_INFO',
    gameInfo: {
      teamName: current.source.teamName.trim(),
      opponentName: current.gameInfo.opponentName.trim(),
      tournamentName: current.gameInfo.tournamentName.trim(),
      tournamentId: current.gameInfo.tournamentId,
      date: current.gameInfo.date,
    },
  })
  return { ok: true, state }
}

function parseSource(value: unknown): BasketballSetupSource | null {
  if (!isPlainObject(value)) return null
  if (value.kind === 'personal') {
    if (!hasExactKeys(value, ['kind', 'teamName', 'seasonId', 'seasonName'])) return null
    if (typeof value.teamName !== 'string' ||
        !isNullableNonEmptyString(value.seasonId) ||
        typeof value.seasonName !== 'string') return null
    return structuredClone(value as BasketballSetupSource)
  }
  if (value.kind === 'team') {
    if (!hasExactKeys(value, [
      'kind', 'teamId', 'seasonId', 'teamName', 'seasonName', 'accessRole',
    ])) return null
    if (!isNonEmptyString(value.teamId) || !isNonEmptyString(value.seasonId) ||
        !isNonEmptyString(value.teamName) || typeof value.seasonName !== 'string' ||
        !isAccessRole(value.accessRole)) return null
    return structuredClone(value as BasketballSetupSource)
  }
  return null
}

function parseGameInfo(value: unknown): BasketballSetupDraftV1['gameInfo'] | null {
  if (!hasExactKeys(value, [
    'opponentName',
    'tournamentMode',
    'tournamentId',
    'tournamentName',
    'tournamentUrl',
    'date',
  ])) return null
  if (typeof value.opponentName !== 'string' ||
      !['none', 'existing', 'new', 'text'].includes(String(value.tournamentMode)) ||
      !isNullableNonEmptyString(value.tournamentId) ||
      typeof value.tournamentName !== 'string' ||
      (value.tournamentUrl !== null && typeof value.tournamentUrl !== 'string') ||
      typeof value.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      Number.isNaN(Date.parse(`${value.date}T00:00:00Z`))) return null
  return structuredClone(value as BasketballSetupDraftV1['gameInfo'])
}

function parsePlayerSetup(value: unknown): BasketballSetupDraftPlayerProgressV2 | null {
  if (!hasExactKeys(value, ['currentStep', 'participants', 'openingLineups']) ||
      !['roster', 'opening_lineup', 'review'].includes(String(value.currentStep)) ||
      !Array.isArray(value.participants) ||
      !hasExactKeys(value.openingLineups, ['tracked', 'opponent'])) return null

  const participants: BasketballSetupDraftParticipantV2[] = []
  const participantIds = new Set<string>()
  const playerIds = new Set<string>()
  for (const item of value.participants) {
    if (!hasExactKeys(item, [
      'participantId', 'playerId', 'displayName', 'number', 'teamSide', 'initialStatus',
    ]) ||
        !isNonEmptyString(item.participantId) ||
        !isNullableNonEmptyString(item.playerId) ||
        !isNonEmptyString(item.displayName) ||
        !isNullableNonEmptyString(item.number) ||
        (item.teamSide !== 'tracked' && item.teamSide !== 'opponent') ||
        !['starter', 'bench', 'dnp'].includes(String(item.initialStatus)) ||
        participantIds.has(item.participantId) ||
        (item.playerId !== null && playerIds.has(item.playerId))) return null
    participantIds.add(item.participantId)
    if (item.playerId !== null) playerIds.add(item.playerId)
    participants.push(structuredClone(item as unknown as BasketballSetupDraftParticipantV2))
  }

  const tracked = parseDraftLineup(value.openingLineups.tracked)
  const opponent = value.openingLineups.opponent === null
    ? null
    : parseDraftLineup(value.openingLineups.opponent)
  if (!tracked || (value.openingLineups.opponent !== null && !opponent)) return null

  const lineupBySide = { tracked, opponent }
  for (const side of ['tracked', 'opponent'] as const) {
    const lineup = lineupBySide[side]
    const sideParticipants = participants.filter(item => item.teamSide === side)
    if (!lineup) {
      if (sideParticipants.some(item => item.initialStatus === 'starter')) return null
      continue
    }
    const ids = new Set(lineup.participantIds)
    if (lineup.participantIds.length > 5 ||
        lineup.participantIds.some(id =>
          !sideParticipants.some(item => item.participantId === id)
        ) ||
        sideParticipants.some(item =>
          (item.initialStatus === 'starter') !== ids.has(item.participantId)
        )) return null
  }
  if (value.currentStep === 'review') {
    for (const lineup of [tracked, opponent].filter(
      (item): item is BasketballSetupDraftLineupV2 => item !== null
    )) {
      if (lineup.participantIds.length < 1 ||
          (lineup.participantIds.length < 5 && !lineup.shortHandedReason)) return null
    }
  }

  return {
    currentStep: value.currentStep as BasketballSetupPlayerStep,
    participants,
    openingLineups: { tracked, opponent },
  }
}

function parseDraftLineup(value: unknown): BasketballSetupDraftLineupV2 | null {
  if (!hasExactKeys(value, ['participantIds', 'shortHandedReason']) ||
      !Array.isArray(value.participantIds) ||
      !value.participantIds.every(isNonEmptyString) ||
      new Set(value.participantIds).size !== value.participantIds.length ||
      !isNullableNonEmptyString(value.shortHandedReason)) return null
  return {
    participantIds: [...value.participantIds],
    shortHandedReason: value.shortHandedReason,
  }
}

function emptyBasketballSetupPlayerProgress(): BasketballSetupDraftPlayerProgressV2 {
  return {
    currentStep: 'roster',
    participants: [],
    openingLineups: {
      tracked: { participantIds: [], shortHandedReason: null },
      opponent: null,
    },
  }
}

function parseEvent(value: unknown): BasketballSetupDraftEventV1 | null {
  if (!hasExactKeys(value, [
    'settingsAuthority',
    'matchOverrides',
    'reviewedRules',
    'reviewedRulesSource',
    'cloudIntent',
  ])) return null
  if (!isPlainObject(value.settingsAuthority)) return null
  const authority = value.settingsAuthority
  if (!hasExactKeys(authority, ['kind', 'revision', 'settings']) ||
      !isNullableRevision(authority.revision)) return null
  let settingsAuthority: BasketballSetupDraftEventV1['settingsAuthority']
  if (authority.kind === 'personal') {
    const parsed = parseBasketballPersonalSettings(authority.settings)
    if (!parsed.ok) return null
    settingsAuthority = {
      kind: 'personal',
      revision: authority.revision as number | null,
      settings: parsed.value,
    }
  } else if (authority.kind === 'team') {
    const parsed = parseBasketballTeamSettings(authority.settings)
    if (!parsed.ok) return null
    settingsAuthority = {
      kind: 'team',
      revision: authority.revision as number | null,
      settings: parsed.value,
    }
  } else {
    return null
  }
  const matchOverrides = normalizeBasketballRuleOverrides(value.matchOverrides)
  const reviewedRules = normalizeBasketballMatchRules(value.reviewedRules)
  const reviewedRulesSource = normalizeBasketballRulesSource(value.reviewedRulesSource)
  if (!matchOverrides || !reviewedRules || !isBasketballStructuredMatchRules(reviewedRules) ||
      !reviewedRulesSource ||
      (value.cloudIntent !== 'automatic' && value.cloudIntent !== 'local_only')) return null
  return {
    settingsAuthority,
    matchOverrides,
    reviewedRules,
    reviewedRulesSource,
    cloudIntent: value.cloudIntent,
  }
}

function ruleFieldValue(
  rules: BasketballMatchRulesV2 | BasketballMatchRulesV3,
  field: BasketballRulesField
): unknown {
  return (rules as unknown as Record<string, unknown>)[field]
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value)
}

function isAccountScope(value: unknown): value is BasketballSetupAccountScope {
  return value === 'anonymous' ||
    (typeof value === 'string' && value.startsWith('user:') && value.slice(5).trim().length > 0)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isNullableRevision(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function isAccessRole(value: unknown): value is BasketballSetupAccessRole {
  return value === 'owner' || value === 'admin' || value === 'scorer'
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function invalid(error: string): BasketballSetupDraftParseResult {
  return { ok: false, error }
}
