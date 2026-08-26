import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SportConfig } from '../../types'
import {
  basketballSetupAccountScope,
  basketballSetupDraftHasMeaningfulEdits,
  basketballSetupDraftMatchesRoute,
  basketballSetupEventMatchesAuthority,
  basketballSetupRuleDifferences,
  buildBasketballSetupGameState,
  createBasketballSetupDraft,
  createBasketballSetupDraftEvent,
  loadBasketballSetupDraft,
  parseBasketballSetupDraft,
  refreshBasketballSetupDraftEvent,
  saveBasketballSetupDraft,
} from './setupDraft'
import {
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
} from './settings'

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

const basketball: SportConfig = {
  id: 'basketball',
  name: 'Basketball',
  icon: 'B',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'PTS',
}

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: () => 'draft-1' })
})

describe('Basketball setup draft', () => {
  it('round-trips a strict account-scoped personal draft', () => {
    const storage = new MemoryStorage()
    const scope = basketballSetupAccountScope('user-1')
    const draft = createBasketballSetupDraft({
      accountScope: scope,
      source: { kind: 'personal', teamName: '', seasonId: null, seasonName: '' },
      now: new Date('2026-08-24T12:00:00.000Z'),
    })
    draft.source.teamName = 'Falcons'
    draft.gameInfo.opponentName = 'Tigers'

    expect(saveBasketballSetupDraft(draft, storage).ok).toBe(true)
    expect(loadBasketballSetupDraft(scope, storage)).toEqual(draft)
    expect(loadBasketballSetupDraft(basketballSetupAccountScope('user-2'), storage)).toBeNull()
  })

  it('rejects unknown fields, mismatched authority, and corrupt persisted drafts', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: '', seasonId: null, seasonName: '' },
    })
    expect(parseBasketballSetupDraft({ ...draft, extra: true }).ok).toBe(false)
    expect(parseBasketballSetupDraft({ ...draft, authority: 'sport_events' }).ok).toBe(false)

    const storage = new MemoryStorage()
    storage.setItem('statkeeper_basketball_setup_draft:anonymous', '{bad json')
    expect(loadBasketballSetupDraft('anonymous', storage)).toBeNull()
  })

  it('keeps route identity and meaningful-edit checks independent of game state', () => {
    const personal = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: '', seasonId: null, seasonName: '' },
    })
    expect(basketballSetupDraftMatchesRoute(personal, null)).toBe(true)
    expect(basketballSetupDraftMatchesRoute(personal, 'team-1')).toBe(false)
    expect(basketballSetupDraftHasMeaningfulEdits(personal)).toBe(false)
    personal.gameInfo.opponentName = 'Tigers'
    expect(basketballSetupDraftHasMeaningfulEdits(personal)).toBe(true)
  })

  it('builds a complete Legacy setup candidate without mutating an active game', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: {
        kind: 'team',
        teamId: 'team-1',
        seasonId: 'season-1',
        teamName: 'Falcons',
        seasonName: 'Fall',
        accessRole: 'scorer',
      },
    })
    draft.gameInfo.opponentName = 'Tigers'
    draft.legacyTeamStatsConfig = { periods: 4 }
    draft.display.defaultCourtFlipped = true

    const built = buildBasketballSetupGameState({
      draft,
      sport: basketball,
      cloudStatus: 'idle',
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.state).toMatchObject({
      gameDataAuthority: null,
      sport: { id: 'basketball' },
      gameInfo: { teamName: 'Falcons', opponentName: 'Tigers' },
      cloudSync: { teamId: 'team-1', seasonId: 'season-1' },
      teamStatsConfig: { periods: 4 },
      players: [],
      basketballCourtOrientation: 'flipped',
    })
  })

  it('persists a complete Event preview while keeping its source authority exact', () => {
    const personalEvent = createBasketballSetupDraftEvent({
      authority: 'personal',
      revision: 3,
      settings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      cloudIntent: 'local_only',
    })
    const teamEvent = createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 4,
      settings: DEFAULT_BASKETBALL_TEAM_SETTINGS,
      cloudIntent: 'automatic',
    })

    expect(personalEvent?.reviewedRulesSource).toMatchObject({
      profileId: 'nfhs',
      personalRevision: 3,
      teamRevision: null,
    })
    expect(teamEvent?.reviewedRulesSource).toMatchObject({
      profileId: 'nfhs',
      personalRevision: null,
      teamRevision: 4,
    })
  })

  it('rejects version-3 authority before a setup draft can be committed', () => {
    expect(createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 5,
      settings: {
        ...structuredClone(DEFAULT_BASKETBALL_TEAM_SETTINGS),
        ruleOverrides: {
          clockModel: 'anchored',
          clockDisplayDirection: 'count_down',
          clockExpiration: 'stop_at_zero',
          stoppageMode: 'explicit',
          equalPlayPolicy: {
            mode: 'off',
            minimumPeriods: null,
            maximumConsecutivePeriods: null,
            maximumPeriodImbalance: null,
          },
        },
      },
      cloudIntent: 'local_only',
    })).toBeNull()
  })

  it('separates a team source from local-only cloud binding metadata', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'user:user-1',
      source: {
        kind: 'team',
        teamId: 'team-1',
        seasonId: 'season-1',
        teamName: 'Falcons',
        seasonName: 'Fall',
        accessRole: 'scorer',
      },
    })
    draft.authority = 'sport_events'
    draft.gameInfo.opponentName = 'Tigers'
    draft.event = createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 4,
      settings: DEFAULT_BASKETBALL_TEAM_SETTINGS,
      cloudIntent: 'local_only',
    })

    const built = buildBasketballSetupGameState({
      draft,
      sport: basketball,
      cloudStatus: 'idle',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.state.cloudSync).toMatchObject({
      eventCloudPolicy: 'local_only',
      teamId: null,
      seasonId: null,
      gameId: null,
    })
    expect(draft.source).toMatchObject({ teamId: 'team-1', seasonId: 'season-1' })
  })

  it('keeps team binding metadata for automatic Event cloud setup', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'user:user-1',
      source: {
        kind: 'team',
        teamId: 'team-1',
        seasonId: 'season-1',
        teamName: 'Falcons',
        seasonName: 'Fall',
        accessRole: 'owner',
      },
    })
    draft.authority = 'sport_events'
    draft.gameInfo.opponentName = 'Tigers'
    draft.event = createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 4,
      settings: DEFAULT_BASKETBALL_TEAM_SETTINGS,
      cloudIntent: 'automatic',
    })

    const built = buildBasketballSetupGameState({
      draft,
      sport: basketball,
      cloudStatus: 'idle',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.state.cloudSync).toMatchObject({
      eventCloudPolicy: 'automatic',
      teamId: 'team-1',
      seasonId: 'season-1',
    })
  })

  it('detects stale source settings and refreshes compatible match overrides exactly', () => {
    const reviewed = createBasketballSetupDraftEvent({
      authority: 'personal',
      revision: 3,
      settings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
      matchOverrides: { personalFoulLimit: 7 },
      cloudIntent: 'local_only',
    })!
    const latest = {
      kind: 'personal' as const,
      revision: 4,
      settings: {
        ...structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS),
        ruleOverrides: { personalFoulLimit: 6 },
      },
    }

    expect(basketballSetupEventMatchesAuthority(reviewed, latest)).toBe(false)
    const refreshed = refreshBasketballSetupDraftEvent(reviewed, latest)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.event.settingsAuthority.revision).toBe(4)
    expect(refreshed.event.reviewedRules.personalFoulLimit).toBe(7)
    expect(refreshed.event.reviewedRulesSource).toEqual({
      profileId: 'nfhs',
      profileVersion: 1,
      personalRevision: 4,
      teamRevision: null,
      hasExplicitMatchOverrides: true,
    })
    expect(basketballSetupRuleDifferences(reviewed.reviewedRules, refreshed.event.reviewedRules))
      .toEqual([])
  })

  it('keeps team authority isolated from personal settings during refresh', () => {
    const reviewed = createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 2,
      settings: DEFAULT_BASKETBALL_TEAM_SETTINGS,
      cloudIntent: 'automatic',
    })!
    const personal = {
      kind: 'personal' as const,
      revision: 8,
      settings: DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
    }

    expect(refreshBasketballSetupDraftEvent(reviewed, personal)).toEqual({
      ok: false,
      error: 'Basketball rules authority no longer matches this setup.',
    })
  })

  it('marks authoritative personal customization as Custom without a match override', () => {
    const event = createBasketballSetupDraftEvent({
      authority: 'personal',
      revision: 6,
      settings: {
        ...structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS),
        ruleOverrides: { personalFoulLimit: 6 },
      },
      cloudIntent: 'local_only',
    })

    expect(event?.matchOverrides).toEqual({})
    expect(event?.reviewedRulesSource.hasExplicitMatchOverrides).toBe(true)
    expect(event?.reviewedRules.personalFoulLimit).toBe(6)
  })
})
