import { useId, useState } from 'react'
import { BASKETBALL_POSITION_OPTIONS, BASKETBALL_POSITION_MAX_LENGTH } from '../../lib/basketball/positions'

export default function BasketballPositionField({ value, onChange, disabled = false }: {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const id = useId()
  const [customSelected, setCustomSelected] = useState(false)
  const [customText, setCustomText] = useState(value ?? '')
  const standard = BASKETBALL_POSITION_OPTIONS.some(position => position === value)
  const custom = customSelected || (value !== null && !standard)
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="text-sm font-medium text-content">Position</label>
    <select id={id} value={custom ? '__custom__' : value ?? ''} disabled={disabled}
      onChange={event => {
        setCustomSelected(event.target.value === '__custom__')
        if (event.target.value === '__custom__') setCustomText('')
        onChange(event.target.value === '__custom__' ? null : event.target.value || null)
      }}
      className="input-field w-full">
      <option value="">Unassigned</option>
      {BASKETBALL_POSITION_OPTIONS.map(position => <option key={position}>{position}</option>)}
      <option value="__custom__">Custom</option>
    </select>
    {custom && <input aria-label="Custom position" value={customSelected ? customText : value ?? ''} disabled={disabled}
      maxLength={BASKETBALL_POSITION_MAX_LENGTH} className="input-field w-full"
      onChange={event => {
        setCustomSelected(true)
        setCustomText(event.target.value)
        onChange(event.target.value)
      }} />}
  </div>
}
