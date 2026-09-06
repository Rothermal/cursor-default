import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveSoccerLineupDefaultsEditorState,
  type SoccerLineupDefaultsRosterPlayer,
} from '../../lib/soccer/lineupDefaultsEditor'
import type { SoccerRole } from '../../lib/soccer/types'

const PLAYER_IDS = {
  forwardStarter: '11111111-1111-4111-8111-111111111111',
  midfielderStarter: '22222222-2222-4222-8222-222222222222',
  defenderBench: '33333333-3333-4333-8333-333333333333',
  goalkeeperStarter: '44444444-4444-4444-8444-444444444444',
  customBench: '55555555-5555-4555-8555-555555555555',
} as const

function player(
  id: string,
  name: string,
  group: SoccerRole['group'],
  number: string | null
): SoccerLineupDefaultsRosterPlayer {
  return {
    id,
    name,
    number,
    role: { group, label: group === 'custom' ? 'Utility' : null },
  }
}

describe('Soccer lineup defaults editor', () => {
  it('groups statuses and orders each group by role without mutating the roster', () => {
    const roster = [
      player(PLAYER_IDS.customBench, 'Utility', 'custom', '8'),
      player(PLAYER_IDS.goalkeeperStarter, 'Keeper', 'goalkeeper', '1'),
      player(PLAYER_IDS.defenderBench, 'Defender', 'defender', '4'),
      player(PLAYER_IDS.midfielderStarter, 'Midfielder', 'midfielder', '6'),
      player(PLAYER_IDS.forwardStarter, 'Forward', 'forward', '9'),
    ]

    const result = deriveSoccerLineupDefaultsEditorState({
      version: 1,
      starterPlayerIds: [
        PLAYER_IDS.goalkeeperStarter,
        PLAYER_IDS.midfielderStarter,
        PLAYER_IDS.forwardStarter,
      ].sort(),
    }, roster, 11)

    expect(result.starters.map(item => item.id)).toEqual([
      PLAYER_IDS.forwardStarter,
      PLAYER_IDS.midfielderStarter,
      PLAYER_IDS.goalkeeperStarter,
    ])
    expect(result.bench.map(item => item.id)).toEqual([
      PLAYER_IDS.defenderBench,
      PLAYER_IDS.customBench,
    ])
    expect(result.warnings).toEqual([])
    expect(roster.map(item => item.id)).toEqual([
      PLAYER_IDS.customBench,
      PLAYER_IDS.goalkeeperStarter,
      PLAYER_IDS.defenderBench,
      PLAYER_IDS.midfielderStarter,
      PLAYER_IDS.forwardStarter,
    ])
  })

  it('warns about empty, excess, and goalkeeper-mismatched starter groups', () => {
    const roster = [
      player(PLAYER_IDS.forwardStarter, 'Forward', 'forward', '9'),
      player(PLAYER_IDS.midfielderStarter, 'Midfielder', 'midfielder', '6'),
    ]

    expect(deriveSoccerLineupDefaultsEditorState({
      version: 1,
      starterPlayerIds: [],
    }, roster, 1).warnings).toEqual([
      'No default starters are selected.',
      'Default starters need exactly one goalkeeper; currently 0.',
    ])

    expect(deriveSoccerLineupDefaultsEditorState({
      version: 1,
      starterPlayerIds: [PLAYER_IDS.forwardStarter, PLAYER_IDS.midfielderStarter],
    }, roster, 1).warnings).toEqual([
      '2 starters are selected for 1 on-field places.',
      'Default starters need exactly one goalkeeper; currently 0.',
    ])
  })

  it('renders status text instead of mutation controls for read-only users', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/soccer/SoccerLineupDefaultsEditor.tsx'),
      'utf8'
    ).replace(/\r\n/g, '\n')

    expect(source).toContain('readOnly ? (')
    expect(source).toContain("{status === 'starter' ? 'Starter' : 'Bench'}")
    expect(source).toContain('role="group"')
    expect(source).toContain('setSoccerLineupDefaultStatus(defaults, player.id, option)')
  })
})
