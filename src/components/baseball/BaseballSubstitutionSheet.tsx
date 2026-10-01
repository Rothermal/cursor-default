import {
  BASEBALL_SUBSTITUTION_KIND_LABELS,
  baseballAvailableSubstitutionKinds,
  baseballDoubleSwitchPicker,
  baseballSubstitutionGroup,
  pickBaseballDoubleSwitch,
  selectedBaseballSubstitution,
  type BaseballSubstitutionChoices,
  type BaseballSubstitutionDraft,
  type BaseballSubstitutionGroup,
} from '../../lib/baseball'

interface BaseballSubstitutionSheetProps {
  teamName: string
  choices: BaseballSubstitutionChoices
  draft: BaseballSubstitutionDraft
  onChange: (draft: BaseballSubstitutionDraft) => void
  /** Opens the BSB-3D pitching change sheet instead. */
  onPitchingChange: (() => void) | null
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

const GROUP_LEGENDS = {
  pinch_hitter: 'Batter',
  pinch_runner: 'Runner',
  courtesy_runner: 'Runner',
  defensive: 'Position',
  position_change: 'Who moves',
  double_switch: 'Position',
  designated_hitter: 'How',
} as const

/**
 * One substitution for the tracked team: pick the kind, then who or where, then the
 * player (BSB-4A). A double switch picks the new pitcher, the new fielder and the batting
 * slots (BSB-4B). Only legal choices are listed, and the summary says exactly what
 * happens before Confirm. Engine rejections stay in the sheet, word for word.
 */
export default function BaseballSubstitutionSheet({
  teamName,
  choices,
  draft,
  onChange,
  onPitchingChange,
  error,
  onCancel,
  onConfirm,
}: BaseballSubstitutionSheetProps) {
  const kinds = baseballAvailableSubstitutionKinds(choices)
  const groups = draft.kind ? choices[draft.kind] : []
  const group = baseballSubstitutionGroup(choices, draft)
  const selected = selectedBaseballSubstitution(choices, draft)

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Substitution">
      <h2 className="font-bold text-content">{teamName} substitution</h2>

      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase text-content-muted">Kind</legend>
        {kinds.length === 0 && !onPitchingChange ? (
          <p className="text-sm text-content-muted">No substitutions are possible right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {kinds.map(kind => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                className={`${draft.kind === kind ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-sm leading-tight`}
                onClick={() => onChange({ kind, groupKey: null, optionKey: null })}
              >
                {BASEBALL_SUBSTITUTION_KIND_LABELS[kind]}
              </button>
            ))}
            {onPitchingChange && (
              <button type="button" className="btn-secondary min-h-11 px-2 text-sm leading-tight" onClick={onPitchingChange}>
                Pitching change
              </button>
            )}
          </div>
        )}
      </fieldset>

      {draft.kind && groups.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">
            {GROUP_LEGENDS[draft.kind]}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {groups.map(entry => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={group?.key === entry.key}
                className={`${group?.key === entry.key ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
                onClick={() => onChange({ kind: draft.kind, groupKey: entry.key, optionKey: null })}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {group && draft.kind === 'double_switch' && (
        <DoubleSwitchPickers group={group} draft={draft} onChange={onChange} />
      )}

      {group && draft.kind !== 'double_switch' && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase text-content-muted">{group.title}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.options.map(entry => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={entry.key === selected?.key}
                className={`${entry.key === selected?.key ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
                onClick={() => onChange({ ...draft, groupKey: group.key, optionKey: entry.key })}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {selected && (
        <div className="rounded-md border border-accent px-3 py-2 text-sm text-content" aria-live="polite">
          {selected.summary.map(line => <p key={line}>{line}</p>)}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!selected} onClick={onConfirm}>Confirm</button>
      </div>
    </section>
  )
}

function DoubleSwitchPickers({
  group,
  draft,
  onChange,
}: {
  group: BaseballSubstitutionGroup
  draft: BaseballSubstitutionDraft
  onChange: (draft: BaseballSubstitutionDraft) => void
}) {
  const parts = draft.parts ?? {}
  const picker = baseballDoubleSwitchPicker(group, parts)
  const pick = (patch: Parameters<typeof pickBaseballDoubleSwitch>[2]) => onChange(pickBaseballDoubleSwitch(group, draft, patch))
  return (
    <>
      <PickerRow legend="New pitcher" entries={picker.pitchers.map(entry => ({ key: entry.id, label: entry.label }))} selected={parts.pitcherId} onPick={id => pick({ pitcherId: id })} />
      {picker.fielders.length > 0 && (
        <PickerRow legend={`New fielder (${group.title.split(' (')[0]})`} entries={picker.fielders.map(entry => ({ key: entry.id, label: entry.label }))} selected={parts.fielderId} onPick={id => pick({ fielderId: id })} />
      )}
      {picker.slots.length > 0 && (
        <PickerRow
          legend="Batting slots"
          entries={picker.slots.map(entry => ({ key: entry.value, label: entry.label }))}
          selected={parts.pitcherBats}
          onPick={value => pick({ pitcherBats: value as 'fielder_slot' | 'pitcher_slot' })}
        />
      )}
    </>
  )
}

function PickerRow({
  legend,
  entries,
  selected,
  onPick,
}: {
  legend: string
  entries: Array<{ key: string; label: string }>
  selected: string | undefined
  onPick: (key: string) => void
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold uppercase text-content-muted">{legend}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(entry => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={entry.key === selected}
            className={`${entry.key === selected ? 'btn-primary' : 'btn-secondary'} min-h-11 px-2 text-left text-sm leading-tight`}
            onClick={() => onPick(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
