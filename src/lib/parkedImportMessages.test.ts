import { describe, expect, it } from 'vitest'
import type { ImportParkedGamesResult } from './gameParking'
import {
  formatCount,
  formatParkedImportMessage,
  formatStorageBytes,
} from './parkedImportMessages'

function result(partial: Partial<ImportParkedGamesResult>): ImportParkedGamesResult {
  return {
    imported: 0,
    skipped: 0,
    skippedExisting: 0,
    skippedAtCap: 0,
    skippedInvalid: 0,
    skippedCloudBinding: 0,
    summaries: [],
    ...partial,
  }
}

describe('formatCount', () => {
  it('singularizes only when the count is exactly one', () => {
    expect(formatCount(1, 'parked game')).toBe('1 parked game')
    expect(formatCount(0, 'parked game')).toBe('0 parked games')
    expect(formatCount(2, 'invalid row')).toBe('2 invalid rows')
  })
})

describe('formatParkedImportMessage', () => {
  it('reports a clean import with no skips', () => {
    expect(formatParkedImportMessage(result({ imported: 1 }))).toBe(
      '1 parked game imported. Reloading...'
    )
  })

  it('lists each skip reason with kept / limit / invalid wording', () => {
    expect(
      formatParkedImportMessage(
        result({
          imported: 2,
          skipped: 7,
          skippedExisting: 3,
          skippedAtCap: 2,
          skippedInvalid: 1,
          skippedCloudBinding: 1,
        })
      )
    ).toBe(
      '2 parked games imported; skipped 3 existing games kept, 2 games over the parked-game limit, 1 invalid row, 1 duplicate cloud binding. Reloading...'
    )
  })
})

describe('formatStorageBytes', () => {
  it('formats bytes and kilobytes for the parked storage readout', () => {
    expect(formatStorageBytes(512)).toBe('512 B')
    expect(formatStorageBytes(1536)).toBe('1.5 KB')
    expect(formatStorageBytes(12_288)).toBe('12 KB')
  })
})
