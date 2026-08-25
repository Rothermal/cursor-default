import type { GameState, SportConfig } from '../../types'
import { gameReducer, createInitialState } from '../gameReducer'
import { setBasketballEventCreationIntent } from './commands'
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
  isBasketballMatchRulesV2,
  normalizeBasketballMatchRules,
  normalizeBasketballRulesSource,
} from './rules'
import { normalizeBasketballRuleOverridesV2 } from './profiles'
import type {
  BasketballMatchRulesV2,
  BasketballRuleOverridesV2,
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
  matchOverrides: BasketballRuleOverridesV2
  reviewedRules: BasketballMatchRulesV2
  reviewedRulesSource: BasketballRulesSource
  cloudIntent: 'automatic' | 'local_only'
}

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

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type BasketballSetupDraftParseResult =
  | { ok: true; value: BasketballSetupDraftV1 }
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
}): BasketballSetupDraftV1 {
  const timestamp = now.toISOString()
  return {
    version: 1,
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
  matchOverrides?: BasketballRuleOverridesV2
}): BasketballSetupDraftEventV1 | null {
  const resolution = resolveBasketballSettingsHierarchy({
    authority,
    personalSettings:
      authority === 'personal' ? settings : DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
    teamSettings: authority === 'team' ? settings : DEFAULT_BASKETBALL_TEAM_SETTINGS,
    matchOverrides,
  })
  if (!resolution.ok) return null
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

export function parseBasketballSetupDraft(
  value: unknown,
  expectedScope?: BasketballSetupAccountScope
): BasketballSetupDraftParseResult {
  if (!hasExactKeys(value, [
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
  ])) return invalid('Basketball setup draft fields are invalid.')
  if (value.version !== 1) return invalid('Basketball setup draft version is unsupported.')
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
  return {
    ok: true,
    value: structuredClone({
      ...value,
      source,
      gameInfo,
      display: { defaultCourtFlipped: value.display.defaultCourtFlipped },
      event,
      legacyTeamStatsConfig,
    } as BasketballSetupDraftV1),
  }
}

export function loadBasketballSetupDraft(
  scope: BasketballSetupAccountScope,
  storage: StorageLike = localStorage
): BasketballSetupDraftV1 | null {
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
  draft: BasketballSetupDraftV1,
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
  draft: BasketballSetupDraftV1,
  requestedTeamId: string | null
): boolean {
  return requestedTeamId
    ? draft.source.kind === 'team' && draft.source.teamId === requestedTeamId
    : draft.source.kind === 'personal'
}

export function basketballSetupDraftHasMeaningfulEdits(
  draft: BasketballSetupDraftV1
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
  draft: BasketballSetupDraftV1
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
  state = gameReducer(state, {
    type: 'SET_CLOUD_SYNC_STATE',
    cloudSync: {
      seasonId: current.source.seasonId,
      teamId: current.source.kind === 'team' ? current.source.teamId : null,
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
  const matchOverrides = normalizeBasketballRuleOverridesV2(value.matchOverrides)
  const reviewedRules = normalizeBasketballMatchRules(value.reviewedRules)
  const reviewedRulesSource = normalizeBasketballRulesSource(value.reviewedRulesSource)
  if (!matchOverrides || !reviewedRules || !isBasketballMatchRulesV2(reviewedRules) ||
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
