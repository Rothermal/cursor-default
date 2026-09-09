import { useState } from 'react'
import { Moon, Sun, Check } from 'lucide-react'
import { useAppearance } from '../context/AppearanceContext'
import ConfirmDialog from '../components/ConfirmDialog'

export default function AppearancePreview() {
  const { theme, setTheme, error } = useAppearance()
  const [open, setOpen] = useState(false)
  return <main className="min-h-screen bg-canvas text-content p-4 sm:p-8">
    <div className="mx-auto max-w-xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Appearance</h1>
        <div className="flex border border-line-strong rounded-lg p-1" role="group" aria-label="Appearance">
          {(['light', 'dark'] as const).map(value => {
            const Icon = value === 'light' ? Sun : Moon
            return <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)} className={`flex items-center gap-2 rounded-md px-3 py-2 ${theme === value ? 'bg-accent text-accent-content' : 'text-content hover:bg-control'}`}><Icon size={18} />{value === 'light' ? 'Light' : 'Dark'}</button>
          })}
        </div>
      </header>
      {error && <p role="status" className="bg-warning text-warning-content border border-warning-line rounded-md p-3">{error}</p>}
      <section className="space-y-3" aria-label="Team">
        <h2 className="text-lg font-semibold">Team details</h2>
        <label className="block">Name<input className="input-field mt-1" defaultValue="Home team" /></label>
        <label className="block">Sport<select className="input-field mt-1"><option>Soccer</option><option>Basketball</option></select></label>
        <label className="block">Season<input className="input-field mt-1" placeholder="Season name" /></label>
        <input aria-label="Unavailable field" className="input-field" value="Unavailable" disabled />
        <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => setOpen(true)}>Save</button><button className="btn-secondary" onClick={() => setOpen(true)}>Review</button><button className="btn-primary" disabled>Saved</button></div>
      </section>
      <ul className="space-y-2" aria-label="Games"><li className="card flex items-center gap-3"><Check aria-hidden="true" /><div><p className="font-semibold">Home team vs Visitors</p><p className="text-content-muted text-sm">Completed</p><p className="text-content-subtle text-sm">Today</p></div></li></ul>
      <div className="space-y-2">
        <p className="p-3 rounded-md border bg-info text-info-content border-info-line">Sync available</p>
        <p className="p-3 rounded-md border bg-success text-success-content border-success-line">Changes saved</p>
        <p className="p-3 rounded-md border bg-warning text-warning-content border-warning-line">Connection unavailable</p>
        <p className="p-3 rounded-md border bg-danger text-danger-content border-danger-line">Save failed</p>
      </div>
      <ConfirmDialog open={open} title="Save changes?" message="Team details will be updated." confirmLabel="Save" cancelLabel="Cancel" destructive={false} onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </div>
  </main>
}
