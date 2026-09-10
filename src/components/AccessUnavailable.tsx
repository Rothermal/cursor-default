interface AccessUnavailableProps {
  title?: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

export default function AccessUnavailable({
  title = 'Access unavailable',
  message,
  actionLabel,
  onAction,
}: AccessUnavailableProps) {
  return (
    <section className="card border-line bg-surface-muted text-center space-y-3">
      <div>
        <h2 className="font-semibold text-content">{title}</h2>
        <p className="text-sm text-content-muted mt-1">{message}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-secondary w-full">
          {actionLabel}
        </button>
      )}
    </section>
  )
}
