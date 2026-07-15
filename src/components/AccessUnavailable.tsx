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
    <section className="card border-slate-200 bg-slate-50 text-center space-y-3">
      <div>
        <h2 className="font-semibold text-slate-700">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">{message}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-secondary w-full">
          {actionLabel}
        </button>
      )}
    </section>
  )
}
