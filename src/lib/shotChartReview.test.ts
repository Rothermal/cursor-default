import { describe, expect, it } from 'vitest'
import { pickRecorderPerPlayer } from './shotChartReview'

interface Row {
  player_id: string
  recorded_by: string
  client_shot_id: string
}

function row(playerId: string, recordedBy: string, shotId: string): Row {
  return { player_id: playerId, recorded_by: recordedBy, client_shot_id: shotId }
}

describe('pickRecorderPerPlayer', () => {
  it('keeps only the primary recorder’s rows for a player with a primary', () => {
    const rows = [
      row('p1', 'userA', 's1'),
      row('p1', 'userB', 's2'),
      row('p1', 'userA', 's3'),
    ]
    const result = pickRecorderPerPlayer(rows, { p1: 'userA' }, 'userB')
    expect(result.map(r => r.client_shot_id)).toEqual(['s1', 's3'])
  })

  it('falls back to the game creator’s rows when there is no primary', () => {
    const rows = [
      row('p1', 'userA', 's1'),
      row('p1', 'userB', 's2'),
    ]
    const result = pickRecorderPerPlayer(rows, {}, 'userB')
    expect(result.map(r => r.client_shot_id)).toEqual(['s2'])
  })

  it('falls back to the primary even when the creator also charted', () => {
    const rows = [
      row('p1', 'creator', 's1'),
      row('p1', 'primary', 's2'),
    ]
    const result = pickRecorderPerPlayer(rows, { p1: 'primary' }, 'creator')
    expect(result.map(r => r.client_shot_id)).toEqual(['s2'])
  })

  it('ignores a primary who recorded no rows for that player (falls through to creator)', () => {
    const rows = [
      row('p1', 'creator', 's1'),
      row('p1', 'other', 's2'),
    ]
    const result = pickRecorderPerPlayer(rows, { p1: 'absent' }, 'creator')
    expect(result.map(r => r.client_shot_id)).toEqual(['s1'])
  })

  it('uses the lowest-ordered recorded_by when neither primary nor creator charted', () => {
    const rows = [
      row('p1', 'zzz', 's1'),
      row('p1', 'aaa', 's2'),
      row('p1', 'mmm', 's3'),
      row('p1', 'aaa', 's4'),
    ]
    const result = pickRecorderPerPlayer(rows, {}, 'not-a-recorder')
    expect(result.map(r => r.client_shot_id)).toEqual(['s2', 's4'])
  })

  it('works with a null creator id', () => {
    const rows = [
      row('p1', 'bbb', 's1'),
      row('p1', 'aaa', 's2'),
    ]
    const result = pickRecorderPerPlayer(rows, {}, null)
    expect(result.map(r => r.client_shot_id)).toEqual(['s2'])
  })

  it('resolves each player independently (no cross-contamination)', () => {
    const rows = [
      row('p1', 'userA', 's1'),
      row('p1', 'userB', 's2'),
      row('p2', 'userA', 's3'),
      row('p2', 'userB', 's4'),
      row('p3', 'userC', 's5'),
    ]
    const result = pickRecorderPerPlayer(
      rows,
      { p1: 'userA', p2: 'userB' },
      'nobody'
    )
    expect(result.map(r => r.client_shot_id)).toEqual(['s1', 's4', 's5'])
  })

  it('preserves input row order within the kept set', () => {
    const rows = [
      row('p2', 'userA', 's1'),
      row('p1', 'userA', 's2'),
      row('p2', 'userA', 's3'),
    ]
    const result = pickRecorderPerPlayer(rows, {}, 'userA')
    expect(result.map(r => r.client_shot_id)).toEqual(['s1', 's2', 's3'])
  })

  it('returns an empty array for empty input', () => {
    expect(pickRecorderPerPlayer([], {}, 'userA')).toEqual([])
  })
})
