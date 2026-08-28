import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SportConfig } from '../../types'
import {
  basketballSetupAccountScope,
  basketballSetupDraftHasMeaningfulEdits,
  basketballSetupDraftMatchesRoute,
  basketballSetupEventMatchesAuthority,
  basketballSetupRuleDifferences,
  basketballVersion3StartSetupFromDraft,
  buildBasketballSetupGameState,
  confirmBasketballSetupOpeningLineup,
  createBasketballSetupDraft,
  createBasketballSetupDraftEvent,
  loadBasketballSetupDraft,
  parseBasketballSetupDraft,
  reconcileBasketballSetupTrackedRoster,
  refreshBasketballSetupDraftEvent,
  resolveBasketballSetupRosterTeamId,
  saveBasketballSetupDraft,
  upgradeBasketballSetupDraftToV2,
  updateBasketballSetupTrackedStatus,
  type BasketballSetupDraftV1,
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
  it('uses committed local-only team identity as a roster source without binding the game', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'user:user-1',
      source: {
        kind: 'team',
        teamId: 'team-1',
        seasonId: 'season-1',
        teamName: 'Falcons',
        seasonName: '2026',
        accessRole: 'scorer',
      },
    })
    draft.authority = 'sport_events'
    draft.event = createBasketballSetupDraftEvent({
      authority: 'team',
      revision: 1,
      settings: DEFAULT_BASKETBALL_TEAM_SETTINGS,
      cloudIntent: 'local_only',
    })
    draft.committedLocalGameId = 'local-game-1'

    expect(resolveBasketballSetupRosterTeamId({
      cloudTeamId: null,
      draft,
      activeLocalGameId: 'local-game-1',
    })).toBe('team-1')
    expect(resolveBasketballSetupRosterTeamId({
      cloudTeamId: null,
      draft,
      activeLocalGameId: 'another-game',
    })).toBeNull()
    expect(resolveBasketballSetupRosterTeamId({
      cloudTeamId: 'bound-team',
      draft: null,
      activeLocalGameId: null,
    })).toBe('bound-team')
  })

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

  it('preserves a version-1 clockless draft without inventing player progress', () => {
    const current = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: '', seasonId: null, seasonName: '' },
    })
    const legacyObject = structuredClone(current) as unknown as Record<string, unknown>
    delete legacyObject.playerSetup
    legacyObject.version = 1
    const legacy = legacyObject as unknown as BasketballSetupDraftV1

    const parsed = parseBasketballSetupDraft(legacy)
    expect(parsed).toEqual({ ok: true, value: legacy })
    if (!parsed.ok) return
    expect(parsed.value).not.toHaveProperty('playerSetup')

    const upgraded = upgradeBasketballSetupDraftToV2(parsed.value)
    expect(upgraded).toMatchObject({
      version: 2,
      playerSetup: {
        currentStep: 'roster',
        participants: [],
        openingLineups: {
          tracked: { participantIds: [], shortHandedReason: null },
          opponent: null,
        },
      },
    })
  })

  it('round-trips strict restart-safe participant statuses and opening authority', () => {
    const draft = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: '', seasonId: null, seasonName: '' },
    })
    draft.playerSetup = {
      currentStep: 'review',
      participants: Array.from({ length: 5 }, (_, index) => ({
        participantId: `participant-${index + 1}`,
        playerId: `player-${index + 1}`,
        displayName: `Player ${index + 1}`,
        number: String(index + 1),
        teamSide: 'tracked' as const,
        initialStatus: 'starter' as const,
      })),
      openingLineups: {
        tracked: {
          participantIds: Array.from({ length: 5 }, (_, index) => `participant-${index + 1}`),
          shortHandedReason: null,
        },
        opponent: null,
      },
    }

    expect(parseBasketballSetupDraft(draft)).toEqual({ ok: true, value: draft })
    expect(parseBasketballSetupDraft({
      ...draft,
      playerSetup: {
        ...draft.playerSetup,
        openingLineups: {
          ...draft.playerSetup.openingLineups,
          tracked: { participantIds: ['missing'], shortHandedReason: null },
        },
      },
    }).ok).toBe(false)
    expect(parseBasketballSetupDraft({
      ...draft,
      playerSetup: {
        ...draft.playerSetup,
        participants: draft.playerSetup.participants.map((participant, index) => ({
          ...participant,
          initialStatus: index < 4 ? 'starter' as const : 'bench' as const,
        })),
        openingLineups: {
          ...draft.playerSetup.openingLineups,
          tracked: {
            participantIds: draft.playerSetup.openingLineups.tracked.participantIds.slice(0, 4),
            shortHandedReason: null,
          },
        },
      },
    }).ok).toBe(false)
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

  it('persists a version-3 authority for the guarded production setup workflow', () => {
    const event = createBasketballSetupDraftEvent({
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
    })
    expect(event?.reviewedRules).toMatchObject({
      rulesSchemaVersion: 3,
      clockModel: 'anchored',
    })
    expect(event?.cloudIntent).toBe('local_only')
  })

  it('keeps stable participant ids while reviewing starter, bench, and DNP status', () => {
    let sequence = 0
    vi.stubGlobal('crypto', { randomUUID: () => `draft-${++sequence}` })
    const draft = createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: 'Aces', seasonId: null, seasonName: '' },
    })
    const roster = Array.from({ length: 6 }, (_, index) => ({
      playerId: `player-${index + 1}`,
      displayName: `Player ${index + 1}`,
      number: String(index + 1),
    }))
    let reviewed = reconcileBasketballSetupTrackedRoster(draft, roster)
    const stableId = reviewed.playerSetup.participants[1].participantId

    for (const participant of reviewed.playerSetup.participants.slice(0, 5)) {
      const result = updateBasketballSetupTrackedStatus(
        reviewed,
        participant.participantId,
        'starter'
      )
      expect(result.ok).toBe(true)
      if (result.ok) reviewed = result.draft
    }
    const dnp = updateBasketballSetupTrackedStatus(
      reviewed,
      reviewed.playerSetup.participants[5].participantId,
      'dnp'
    )
    expect(dnp.ok).toBe(true)
    if (dnp.ok) reviewed = dnp.draft
    expect(updateBasketballSetupTrackedStatus(
      reviewed,
      reviewed.playerSetup.participants[5].participantId,
      'starter'
    )).toMatchObject({ ok: false })

    const confirmed = confirmBasketballSetupOpeningLineup(reviewed, '')
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.draft.playerSetup.currentStep).toBe('review')
    expect(confirmed.draft.playerSetup.openingLineups.tracked.participantIds).toHaveLength(5)
    expect(basketballVersion3StartSetupFromDraft(confirmed.draft, true)).toMatchObject({
      openingLineups: { tracked: { shortHandedReason: null } },
    })

    const reconciled = reconcileBasketballSetupTrackedRoster(confirmed.draft, [
      roster[1], roster[0], ...roster.slice(2),
    ])
    expect(reconciled.playerSetup.participants[0].participantId).toBe(stableId)
  })

  it('requires a reason for a one-through-four opening lineup', () => {
    let sequence = 0
    vi.stubGlobal('crypto', { randomUUID: () => `short-${++sequence}` })
    const draft = reconcileBasketballSetupTrackedRoster(createBasketballSetupDraft({
      accountScope: 'anonymous',
      source: { kind: 'personal', teamName: 'Aces', seasonId: null, seasonName: '' },
    }), Array.from({ length: 4 }, (_, index) => ({
      playerId: `player-${index + 1}`,
      displayName: `Player ${index + 1}`,
      number: null,
    })))
    let selected = draft
    for (const participant of draft.playerSetup.participants) {
      const result = updateBasketballSetupTrackedStatus(
        selected,
        participant.participantId,
        'starter'
      )
      if (result.ok) selected = result.draft
    }
    expect(confirmBasketballSetupOpeningLineup(selected, '')).toMatchObject({ ok: false })
    expect(confirmBasketballSetupOpeningLineup(selected, 'Only four eligible players')).toMatchObject({
      ok: true,
      draft: {
        playerSetup: {
          openingLineups: {
            tracked: { shortHandedReason: 'Only four eligible players' },
          },
        },
      },
    })
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
