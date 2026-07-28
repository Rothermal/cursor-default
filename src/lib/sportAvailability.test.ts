import { describe, expect, it } from 'vitest'
import {
  getSportAvailabilityPolicy,
  SOCCER_RELEASED_IN_PRODUCTION,
} from './sportAvailability'

describe('getSportAvailabilityPolicy', () => {
  it('keeps the development Soccer preview behind the user toggle', () => {
    expect(
      getSportAvailabilityPolicy('soccer', false, { development: true })
    ).toMatchObject({
      releaseStage: 'preview',
      toggleAvailable: true,
      discoverable: false,
      canStartNewGame: false,
      canAccessExisting: true,
    })
    expect(
      getSportAvailabilityPolicy('soccer', true, { development: true })
    ).toMatchObject({
      releaseStage: 'preview',
      discoverable: true,
      canStartNewGame: true,
    })
  })

  it('keeps unreleased production Soccer hidden while preserving existing access', () => {
    expect(
      getSportAvailabilityPolicy('soccer', true, {
        development: false,
        soccerReleasedInProduction: false,
      })
    ).toEqual({
      releaseStage: 'unreleased',
      toggleAvailable: false,
      discoverable: false,
      canStartNewGame: false,
      canAccessExisting: true,
    })
  })

  it('uses the normal toggle after the production release flag is enabled', () => {
    expect(
      getSportAvailabilityPolicy('soccer', false, {
        development: false,
        soccerReleasedInProduction: true,
      })
    ).toEqual({
      releaseStage: 'released',
      toggleAvailable: true,
      discoverable: false,
      canStartNewGame: false,
      canAccessExisting: true,
    })
    expect(
      getSportAvailabilityPolicy('soccer', true, {
        development: false,
        soccerReleasedInProduction: true,
      })
    ).toMatchObject({
      releaseStage: 'released',
      toggleAvailable: true,
      discoverable: true,
      canStartNewGame: true,
    })
  })

  it('ships Soccer as opt-in in production', () => {
    expect(SOCCER_RELEASED_IN_PRODUCTION).toBe(true)
  })

  it.each(['basketball', 'baseball', 'football', 'hockey'])(
    'keeps %s controlled by settings without restricting history',
    sportId => {
    expect(
      getSportAvailabilityPolicy(sportId, false, { development: false })
    ).toEqual({
      releaseStage: null,
      toggleAvailable: true,
      discoverable: false,
      canStartNewGame: false,
      canAccessExisting: true,
    })
    }
  )
})
