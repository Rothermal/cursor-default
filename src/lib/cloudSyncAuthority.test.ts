import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  latestRows: [] as Array<Record<string, unknown>>,
  byIdRow: null as Record<string, unknown> | null,
  setupGameIds: [] as string[],
  setupLookups: [] as string[][],
  sportNullFilters: 0,
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'game_event_setup_snapshots') {
        return {
          select: () => ({
            in: (_column: string, gameIds: string[]) => {
              mock.setupLookups.push(gameIds)
              return Promise.resolve({
                data: mock.setupGameIds.map(game_id => ({ game_id })),
                error: null,
              })
            },
          }),
        }
      }

      if (table === 'games') {
        const result = () => ({ data: mock.latestRows, error: null })
        const builder: Record<string, unknown> = {
          maybeSingle: () => Promise.resolve({ data: mock.byIdRow, error: null }),
          then: (
            onOk: (value: ReturnType<typeof result>) => unknown,
            onError: (error: unknown) => unknown
          ) => Promise.resolve(result()).then(onOk, onError),
        }
        builder.eq = () => builder
        builder.not = () => builder
        builder.in = () => builder
        builder.order = () => builder
        builder.is = () => {
          mock.sportNullFilters += 1
          return builder
        }
        return { select: () => builder }
      }

      return {}
    },
  },
}))

import { loadCloudGameById, loadLatestCloudGame } from './cloudSync'

function game(id: string, sportId: string): Record<string, unknown> {
  return {
    id,
    team_id: 'team-1',
    opponent_name: 'Bears',
    tournament_name: null,
    game_date: '2026-08-21',
    opponent_score: 0,
    status: 'in_progress',
    created_at: '2026-08-21T00:00:00Z',
    sport_id: sportId,
  }
}

describe('legacy cloud loader authority', () => {
  beforeEach(() => {
    mock.latestRows = []
    mock.byIdRow = null
    mock.setupGameIds = []
    mock.setupLookups = []
    mock.sportNullFilters = 0
  })

  it('does not filter populated sport ids and skips event-authority startup rows', async () => {
    mock.latestRows = [game('event-basketball', 'basketball'), game('old-soccer', 'soccer')]
    mock.setupGameIds = ['event-basketball']

    await expect(loadLatestCloudGame('user-1')).resolves.toBeNull()

    expect(mock.sportNullFilters).toBe(0)
    expect(mock.setupLookups).toEqual([['event-basketball']])
  })

  it('consults setup authority before opening a populated game by id', async () => {
    mock.byIdRow = game('event-basketball', 'basketball')
    mock.setupGameIds = ['event-basketball']

    await expect(loadCloudGameById('user-1', 'event-basketball')).resolves.toBeNull()

    expect(mock.setupLookups).toEqual([['event-basketball']])
  })
})
