import { describe, expect, it } from 'vitest'
import {
  emptyHockeyLineupDefaults,
  parseHockeyLineupDefaults,
  pruneHockeyLineupDefaults,
} from './lineupDefaults'
import {
  defaultHockeyDressedAs,
  hockeyPositionLabel,
  normalizeHockeyPosition,
  sortHockeyActors,
} from './positions'
import { createHockeyMatchRules } from './profiles'
import { HOCKEY_RULES_FIELDS } from './rules'
import {
  hockeyTrackedAttackingDirection,
  normalizeHockeyMatchSetup,
  prefillHockeyOpeningLineup,
  validateHockeyMatchSetup,
} from './setup'
import type { HockeyMatchParticipant, HockeyMatchSetup, HockeyRuleSource, HockeyRulesField } from './types'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function participant(n: number, position: string | null, dressedAs = defaultHockeyDressedAs(position)): HockeyMatchParticipant {
  return {
    id: `p${n}`,
    playerId: uuid(n),
    displayName: `Player ${n}`,
    number: String(n),
    position,
    dressedAs,
  }
}

function setup(overrides: Partial<HockeyMatchSetup> = {}): HockeyMatchSetup {
  const participants = [
    participant(1, 'G'),
    participant(2, 'C'),
    participant(3, 'LW'),
    participant(4, 'RW'),
    participant(5, 'D'),
    participant(6, 'D'),
    participant(7, 'C'),
    participant(30, 'G'),
  ]
  return {
    version: 1,
    trackedTeam: 'home',
    opponentName: 'Rivals',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: createHockeyMatchRules(),
    rulesSource: Object.fromEntries(HOCKEY_RULES_FIELDS.map(field => [field, 'built_in'])) as Record<
      HockeyRulesField,
      HockeyRuleSource
    >,
    firstPeriodAttackingDirection: 'left_to_right',
    participants,
    openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6'] },
    opponentGoalie: { id: 'opp-goalie', label: null, number: '35' },
    ...overrides,
  }
}

describe('hockey positions', () => {
  it('normalizes standard codes, keeps custom labels, and treats blanks as Unassigned', () => {
    expect(normalizeHockeyPosition(' lw ')).toBe('LW')
    expect(normalizeHockeyPosition('Rover')).toBe('Rover')
    expect(normalizeHockeyPosition('  ')).toBeNull()
    expect(normalizeHockeyPosition('soccer:forward')).toBe('soccer:forward')
    expect(normalizeHockeyPosition(null)).toBeNull()
    expect(hockeyPositionLabel('D')).toBe('Defense')
    expect(hockeyPositionLabel(null)).toBe('Unassigned')
    expect(defaultHockeyDressedAs('G')).toBe('goalie')
    expect(defaultHockeyDressedAs(null)).toBe('skater')
  })

  it('orders actors by position, custom, Unassigned, then number and name', () => {
    const actors = [
      { id: 'a', displayName: 'Ann', number: '9', position: null },
      { id: 'b', displayName: 'Bo', number: '4', position: 'D' },
      { id: 'c', displayName: 'Cy', number: '10', position: 'C' },
      { id: 'd', displayName: 'Di', number: '2', position: 'C' },
      { id: 'e', displayName: 'Ed', number: null, position: 'Rover' },
      { id: 'f', displayName: 'Fi', number: '31', position: 'G' },
    ]
    expect(sortHockeyActors(actors).map(actor => actor.id)).toEqual(['d', 'c', 'b', 'f', 'e', 'a'])
  })
})

describe('hockey lineup defaults', () => {
  it('parses exact defaults, normalizes ids, and rejects conflicts', () => {
    const parsed = parseHockeyLineupDefaults({
      version: 1,
      starterPlayerIds: [uuid(3).toUpperCase(), uuid(2)],
      startingGoaliePlayerId: uuid(1),
      backupGoaliePlayerId: null,
    })
    expect(parsed).toEqual({
      version: 1,
      starterPlayerIds: [uuid(2), uuid(3)],
      startingGoaliePlayerId: uuid(1),
      backupGoaliePlayerId: null,
    })
    const base = emptyHockeyLineupDefaults()
    expect(parseHockeyLineupDefaults(base)).toEqual(base)
    expect(parseHockeyLineupDefaults({ ...base, extra: 1 })).toBeNull()
    expect(parseHockeyLineupDefaults({ ...base, starterPlayerIds: [uuid(1), uuid(1)] })).toBeNull()
    expect(parseHockeyLineupDefaults({ ...base, starterPlayerIds: ['not-a-uuid'] })).toBeNull()
    expect(parseHockeyLineupDefaults({
      ...base,
      starterPlayerIds: [1, 2, 3, 4, 5, 6, 7].map(uuid),
    })).toBeNull()
    expect(parseHockeyLineupDefaults({ ...base, startingGoaliePlayerId: uuid(1), backupGoaliePlayerId: uuid(1) })).toBeNull()
    expect(parseHockeyLineupDefaults({ ...base, starterPlayerIds: [uuid(1)], startingGoaliePlayerId: uuid(1) })).toBeNull()
  })

  it('prunes only on an explicit call', () => {
    const defaults = parseHockeyLineupDefaults({
      version: 1,
      starterPlayerIds: [uuid(2), uuid(3)],
      startingGoaliePlayerId: uuid(1),
      backupGoaliePlayerId: uuid(30),
    })!
    expect(pruneHockeyLineupDefaults(defaults, new Set([uuid(2), uuid(30)]))).toEqual({
      version: 1,
      starterPlayerIds: [uuid(2)],
      startingGoaliePlayerId: null,
      backupGoaliePlayerId: uuid(30),
    })
  })
})

describe('hockey setup snapshot', () => {
  it('accepts a valid setup and returns a clone', () => {
    const value = setup()
    const parsed = normalizeHockeyMatchSetup(JSON.parse(JSON.stringify(value)))
    expect(parsed).toEqual(value)
    expect(parsed).not.toBe(value)
  })

  it('rejects unknown fields, bad rules, sources, and directions', () => {
    expect(normalizeHockeyMatchSetup({ ...setup(), extra: true })).toBeNull()
    expect(normalizeHockeyMatchSetup({ ...setup(), version: 2 })).toBeNull()
    expect(normalizeHockeyMatchSetup({ ...setup(), trackedTeam: 'visitor' })).toBeNull()
    expect(normalizeHockeyMatchSetup({
      ...setup(),
      rulesSnapshot: { ...createHockeyMatchRules(), clockModel: 'none' },
    })).toBeNull()
    expect(normalizeHockeyMatchSetup({
      ...setup(),
      rulesSource: { ...setup().rulesSource, regulation: 'league' },
    })).toBeNull()
    expect(normalizeHockeyMatchSetup({ ...setup(), firstPeriodAttackingDirection: 'unknown' })).toBeNull()
    expect(normalizeHockeyMatchSetup({
      ...setup(),
      participants: [...setup().participants, { ...participant(8, 'c'), id: 'p8' }],
    })).toBeNull()
  })

  it('validates the opening goalie and skater count against the rules', () => {
    expect(validateHockeyMatchSetup(setup())).toEqual({ ok: true })
    expect(validateHockeyMatchSetup(setup({
      openingLineup: { goalieParticipantId: 'p2', skaterParticipantIds: ['p7', 'p3', 'p4', 'p5', 'p6'] },
    }))).toMatchObject({ ok: false, message: 'The starting goalie must be dressed as a goalie.' })
    expect(validateHockeyMatchSetup(setup({
      openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5'] },
    }))).toMatchObject({ ok: false, message: 'Choose 5 starting skaters.' })
    expect(validateHockeyMatchSetup(setup({
      openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p30'] },
    }))).toMatchObject({ ok: false, message: 'Starting skaters must be dressed as skaters.' })
    expect(validateHockeyMatchSetup(setup({
      openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p2', 'p4', 'p5', 'p6'] },
    }))).toMatchObject({ ok: false })
    expect(validateHockeyMatchSetup(setup({
      rulesSnapshot: { ...createHockeyMatchRules(), skatersPerSide: 4, minimumSkaters: 3 },
      openingLineup: { goalieParticipantId: 'p1', skaterParticipantIds: ['p2', 'p3', 'p5', 'p6'] },
    }))).toEqual({ ok: true })
  })

  it('rejects duplicate ids and a roster player dressed twice', () => {
    expect(validateHockeyMatchSetup(setup({
      opponentGoalie: { id: 'p1', label: null, number: null },
    }))).toMatchObject({ ok: false })
    const duplicate = { ...participant(2, 'C'), id: 'p99' }
    expect(validateHockeyMatchSetup(setup({
      participants: [...setup().participants, duplicate],
    }))).toMatchObject({ ok: false, message: 'A roster player can be dressed only once.' })
  })
})

describe('hockey opening lineup prefill', () => {
  it('uses only team defaults and never infers starters', () => {
    const participants = setup().participants
    expect(prefillHockeyOpeningLineup(participants, null)).toEqual({
      goalieParticipantId: null,
      skaterParticipantIds: [],
    })
    const defaults = parseHockeyLineupDefaults({
      version: 1,
      starterPlayerIds: [uuid(2), uuid(3), uuid(99)],
      startingGoaliePlayerId: uuid(30),
      backupGoaliePlayerId: null,
    })!
    expect(prefillHockeyOpeningLineup(participants, defaults)).toEqual({
      goalieParticipantId: 'p30',
      skaterParticipantIds: ['p2', 'p3'],
    })
  })

  it('skips a default goalie dressed as a skater for this game', () => {
    const participants = setup().participants.map(entry =>
      entry.id === 'p30' ? { ...entry, dressedAs: 'skater' as const } : entry
    )
    const defaults = { ...emptyHockeyLineupDefaults(), startingGoaliePlayerId: uuid(30) }
    expect(prefillHockeyOpeningLineup(participants, defaults).goalieParticipantId).toBeNull()
  })
})

describe('hockey attacking direction', () => {
  it('alternates regulation periods from either initial direction', () => {
    for (const first of ['left_to_right', 'right_to_left'] as const) {
      const value = setup({ firstPeriodAttackingDirection: first })
      const other = first === 'left_to_right' ? 'right_to_left' : 'left_to_right'
      expect([1, 2, 3].map(number => hockeyTrackedAttackingDirection(value, { kind: 'regulation', number })))
        .toEqual([first, other, first])
      expect(hockeyTrackedAttackingDirection(value, { kind: 'shootout' })).toBeNull()
    }
  })

  it('follows the overtime ends policy and returns null without overtime', () => {
    const nhl = setup({ rulesSnapshot: createHockeyMatchRules('nhl_playoffs') })
    expect([1, 2].map(number => hockeyTrackedAttackingDirection(nhl, { kind: 'overtime', number })))
      .toEqual(['right_to_left', 'left_to_right'])
    const sameEnds = setup({
      rulesSnapshot: {
        ...createHockeyMatchRules('nhl_playoffs'),
        overtime: { ...createHockeyMatchRules('nhl_playoffs').overtime!, endsPolicy: 'same_as_last_regulation' },
      },
    })
    expect([1, 2].map(number => hockeyTrackedAttackingDirection(sameEnds, { kind: 'overtime', number })))
      .toEqual(['left_to_right', 'left_to_right'])
    expect(hockeyTrackedAttackingDirection(setup(), { kind: 'overtime', number: 1 })).toBeNull()
  })

  it('does not depend on Home/Away', () => {
    const home = setup({ trackedTeam: 'home' })
    const away = setup({ trackedTeam: 'away' })
    expect(hockeyTrackedAttackingDirection(home, { kind: 'regulation', number: 1 }))
      .toBe(hockeyTrackedAttackingDirection(away, { kind: 'regulation', number: 1 }))
  })
})
