import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canOfferDeletedSourcePlayerRecovery,
  DELETED_SOURCE_PLAYER_BINDING_ERROR,
  deletedSourcePlayerRecoverySettlementPatch,
} from './deletedSourceRecovery'

describe('deleted source player recovery', () => {
  it('offers recovery only to owners and admins for the exact binding failure', () => {
    const error = `Soccer game binding failed: ${DELETED_SOURCE_PLAYER_BINDING_ERROR}`

    expect(canOfferDeletedSourcePlayerRecovery(error, 'owner')).toBe(true)
    expect(canOfferDeletedSourcePlayerRecovery(error, 'admin')).toBe(true)
    expect(canOfferDeletedSourcePlayerRecovery(error, 'scorer')).toBe(false)
    expect(canOfferDeletedSourcePlayerRecovery(error, 'viewer')).toBe(false)
    expect(canOfferDeletedSourcePlayerRecovery('Cloud sync failed', 'owner')).toBe(false)
  })

  it('settles recovery as one attempt instead of leaving sticky approval', () => {
    expect({
      allowDeletedSourcePlayerRecovery: true,
      ...deletedSourcePlayerRecoverySettlementPatch(),
    }).toEqual({ allowDeletedSourcePlayerRecovery: undefined })
  })

  it('settles the flag in both successful and failed sync branches', () => {
    const context = readFileSync(
      resolve(process.cwd(), 'src/context/GameContext.tsx'),
      'utf8'
    )
    expect(context.match(/deletedSourcePlayerRecoverySettlementPatch\(\)/g)).toHaveLength(3)
  })
})
