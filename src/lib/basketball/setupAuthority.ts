import {
  loadTeamSportSettings,
  loadUserSportSettings,
  type SportSettingsCloudLoadResult,
} from '../sportSettingsCloud'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
  parseBasketballPersonalSettings,
  type BasketballPersonalSettingsV1,
} from './settings'
import type {
  BasketballSetupAuthoritySnapshot,
  BasketballSetupSource,
} from './setupDraft'
import { parseCloudBasketballTeamSettings } from './teamSettingsSync'

export type BasketballSetupAuthorityLoadResult =
  | { ok: true; authority: BasketballSetupAuthoritySnapshot }
  | { ok: false; error: string }

export interface BasketballSetupAuthorityLoaders {
  personal: () => Promise<SportSettingsCloudLoadResult>
  team: (teamId: string) => Promise<SportSettingsCloudLoadResult>
}

const defaultLoaders: BasketballSetupAuthorityLoaders = {
  personal: () => loadUserSportSettings('basketball'),
  team: teamId => loadTeamSportSettings(teamId, 'basketball'),
}

export async function loadLatestBasketballSetupAuthority({
  source,
  personalSettings,
  cloudEnabled,
  loaders = defaultLoaders,
}: {
  source: BasketballSetupSource
  personalSettings: BasketballPersonalSettingsV1
  cloudEnabled: boolean
  loaders?: BasketballSetupAuthorityLoaders
}): Promise<BasketballSetupAuthorityLoadResult> {
  if (!cloudEnabled) {
    if (source.kind === 'team') {
      return { ok: false, error: 'Reconnect before checking shared Basketball defaults.' }
    }
    const parsed = parseBasketballPersonalSettings(personalSettings)
    return parsed.ok
      ? { ok: true, authority: { kind: 'personal', revision: null, settings: parsed.value } }
      : { ok: false, error: parsed.error }
  }

  let loaded: SportSettingsCloudLoadResult
  try {
    loaded = source.kind === 'team'
      ? await loaders.team(source.teamId)
      : await loaders.personal()
  } catch {
    return {
      ok: false,
      error: 'The latest Basketball defaults could not be checked. Try again.',
    }
  }
  if (loaded.status === 'loaded') {
    if (source.kind === 'team') {
      const parsed = parseCloudBasketballTeamSettings(loaded.record)
      return parsed
        ? {
            ok: true,
            authority: {
              kind: 'team',
              revision: parsed.revision,
              settings: parsed.settings,
            },
          }
        : { ok: false, error: 'Shared Basketball defaults are invalid or unsupported.' }
    }
    const parsed = parseBasketballPersonalSettings(loaded.record.settings)
    return parsed.ok &&
      loaded.record.sportId === 'basketball' &&
      loaded.record.schemaVersion === BASKETBALL_SETTINGS_SCHEMA_VERSION
      ? {
          ok: true,
          authority: {
            kind: 'personal',
            revision: loaded.record.revision,
            settings: parsed.value,
          },
        }
      : { ok: false, error: 'Personal Basketball defaults are invalid or unsupported.' }
  }
  if (loaded.status === 'missing') {
    return source.kind === 'team'
      ? {
          ok: true,
          authority: {
            kind: 'team',
            revision: null,
            settings: structuredClone(DEFAULT_BASKETBALL_TEAM_SETTINGS),
          },
        }
      : {
          ok: true,
          authority: {
            kind: 'personal',
            revision: null,
            settings: structuredClone(personalSettings),
          },
        }
  }
  if (loaded.status === 'backend_update_required' || loaded.status === 'error') {
    return { ok: false, error: loaded.error }
  }
  return { ok: false, error: 'Basketball settings are unavailable on this device.' }
}
