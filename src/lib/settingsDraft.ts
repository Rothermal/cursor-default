/**
 * An unsaved settings draft and the revision it was edited from (HKY-5C). A draft adopts
 * newly loaded or saved settings, and their revision, only while it has no edits of its own;
 * an edited draft keeps the revision it started from, so a save after another device's
 * change fails compare-and-swap and asks the recorder to choose instead of overwriting.
 */
export interface SettingsDraftState<TSettings> {
  draft: TSettings
  /** Revision of the saved copy the draft was taken from; pass it to `save`. */
  baseRevision: number | null
  /** Fingerprint of the saved copy last seen, to tell an untouched draft from an edited one. */
  savedFingerprint: string
}

export function createSettingsDraft<TSettings>(
  saved: TSettings,
  revision: number | null,
  fingerprint: (settings: TSettings) => string
): SettingsDraftState<TSettings> {
  return { draft: structuredClone(saved), baseRevision: revision, savedFingerprint: fingerprint(saved) }
}

/** Follow the saved copy. Returns the same state when nothing changes. */
export function syncSettingsDraft<TSettings>(
  state: SettingsDraftState<TSettings>,
  saved: TSettings,
  revision: number | null,
  fingerprint: (settings: TSettings) => string
): SettingsDraftState<TSettings> {
  const next = fingerprint(saved)
  const current = fingerprint(state.draft)
  if (current === state.savedFingerprint || current === next) {
    if (current === next && state.baseRevision === revision && state.savedFingerprint === next) return state
    return { draft: current === next ? state.draft : structuredClone(saved), baseRevision: revision, savedFingerprint: next }
  }
  return state.savedFingerprint === next ? state : { ...state, savedFingerprint: next }
}

export function editSettingsDraft<TSettings>(state: SettingsDraftState<TSettings>, draft: TSettings): SettingsDraftState<TSettings> {
  return { ...state, draft }
}
