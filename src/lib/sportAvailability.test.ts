import { describe, expect, it } from 'vitest'
import {
  BASKETBALL_EVENT_RELEASE_STAGE,
  getBasketballEventCreationPolicy,
  getSportAvailabilityPolicy,
  SOCCER_RELEASED_IN_PRODUCTION,
} from './sportAvailability'

describe('getSportAvailabilityPolicy', () => {
  it.each([
    ['internal', true, false, false, true],
    ['internal', true, true, true, true],
    ['internal', false, false, false, false],
    ['internal', false, true, false, false],
    ['opt_in', true, false, false, true],
    ['opt_in', true, true, true, true],
    ['opt_in', false, false, false, true],
    ['opt_in', false, true, true, true],
  ] as const)(
    'resolves Basketball Event %s development=%s enabled=%s',
    (releaseStage, development, enabled, canCreate, preferenceAvailable) => {
      expect(getBasketballEventCreationPolicy(enabled, {
        development,
        releaseStage,
      })).toEqual({
        releaseStage,
        preferenceAvailable,
        canCreateNewEventGame: canCreate,
        canAccessExistingEventGames: true,
      })
    }
  )

  it('activates BKE-5D2 production only through the default-off device preference', () => {
    expect(BASKETBALL_EVENT_RELEASE_STAGE).toBe('opt_in')
    expect(getBasketballEventCreationPolicy(false, { development: false })).toEqual({
      releaseStage: 'opt_in',
      preferenceAvailable: true,
      canCreateNewEventGame: false,
      canAccessExistingEventGames: true,
    })
    expect(getBasketballEventCreationPolicy(true, { development: false })).toEqual({
      releaseStage: 'opt_in',
      preferenceAvailable: true,
      canCreateNewEventGame: true,
      canAccessExistingEventGames: true,
    })
  })

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
