import { describe, expect, it } from 'vitest'
import { playerDisplayName, playerRosterSelectLabel, teamDisplayName } from './display'

describe('teamDisplayName', () => {
  it('prefers trimmed nickname over official name', () => {
    expect(teamDisplayName({ name: 'Riverside High', nickname: '  Eagles  ' })).toBe('Eagles')
  })

  it('falls back to name when nickname is blank', () => {
    expect(teamDisplayName({ name: 'Riverside High', nickname: '   ' })).toBe('Riverside High')
    expect(teamDisplayName({ name: 'Riverside High' })).toBe('Riverside High')
  })
})

describe('playerDisplayName', () => {
  it('prefers nickname, else first+last, else Player', () => {
    expect(
      playerDisplayName({ first_name: 'Ada', last_name: 'Lovelace', nickname: 'Ace' })
    ).toBe('Ace')
    expect(playerDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace')
    expect(playerDisplayName({ first_name: '', last_name: null, nickname: null })).toBe('Player')
  })
})

describe('playerRosterSelectLabel', () => {
  it('always shows legal name and optional nickname suffix', () => {
    expect(
      playerRosterSelectLabel({ first_name: 'Ada', last_name: 'Lovelace', nickname: 'Ace' })
    ).toBe('Ada Lovelace (Ace)')
    expect(playerRosterSelectLabel({ first_name: 'Ada', last_name: 'Lovelace' })).toBe(
      'Ada Lovelace'
    )
  })
})
