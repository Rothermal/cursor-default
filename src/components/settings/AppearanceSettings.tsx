import { Moon, Sun } from 'lucide-react'
import { useAppearance } from '../../context/AppearanceContext'

export default function AppearanceSettings() {
  const { theme, error, setTheme } = useAppearance()
  if (document.documentElement.dataset.appearancePreview !== 'true') return null
  const unavailable = !window.statkeeperAppearance
  return (
    <section className="border-b border-line pb-5" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="mb-3 text-lg font-semibold text-content">Appearance</h2>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-control p-1" role="group" aria-label="Appearance">
        {([['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={theme === value} disabled={unavailable}
            onClick={() => setTheme(value)}
            className={`flex h-11 min-w-0 items-center justify-center gap-2 rounded-md text-sm font-semibold disabled:bg-control-disabled disabled:text-content-disabled ${theme === value ? 'bg-accent text-accent-content' : 'text-content-muted hover:bg-control-hover'}`}>
            <Icon size={18} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 break-words rounded-md border border-warning-line bg-warning p-3 text-sm text-warning-content">{error}</p>}
    </section>
  )
}
