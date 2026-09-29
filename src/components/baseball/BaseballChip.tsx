/** A toggle chip for the Baseball capture sheets. */
export default function BaseballChip({
  label,
  selected,
  onClick,
  wide = false,
  disabled = false,
}: {
  label: string
  selected: boolean
  onClick: () => void
  wide?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`${selected ? 'btn-primary' : 'btn-secondary'} min-h-11 px-1 text-sm leading-tight ${wide ? 'col-span-2' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
