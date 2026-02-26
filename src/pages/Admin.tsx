import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useSettings } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'

export default function Admin() {
  const navigate = useNavigate()
  const { isSportEnabled, toggleSport } = useSettings()
  const { isConfigured, user } = useAuth()

  const enabledCount = sports.filter(s => isSportEnabled(s.id)).length

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Settings</h1>
            <p className="text-sm opacity-80">Configure available sports</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-700">Sports</h2>
            <span className="text-sm text-slate-400">
              {enabledCount} of {sports.length} enabled
            </span>
          </div>

          <div className="space-y-2">
            {sports.map(sport => {
              const enabled = isSportEnabled(sport.id)
              return (
                <div
                  key={sport.id}
                  className={`
                    card flex items-center justify-between py-3 transition-colors
                    ${enabled ? '' : 'opacity-60'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{sport.icon}</span>
                    <div>
                      <span className="font-medium text-slate-700">{sport.name}</span>
                      <p className="text-xs text-slate-400">
                        {sport.categories.reduce((n, c) => n + c.actions.length, 0)} stats
                        across {sport.categories.length} categories
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleSport(sport.id)}
                    className={`
                      relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0
                      ${enabled ? 'bg-blue-600' : 'bg-slate-300'}
                    `}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${sport.name}`}
                  >
                    <span
                      className={`
                        absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow
                        transition-transform duration-200
                        ${enabled ? 'translate-x-5' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </div>
              )
            })}
          </div>

          {enabledCount === 0 && (
            <p className="text-center text-sm text-amber-600 mt-4 bg-amber-50 rounded-xl p-3">
              Enable at least one sport to start tracking games.
            </p>
          )}
        </section>

        {isConfigured && user && (
          <section className="card mt-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Cloud Teams</h2>
            <p className="text-sm text-slate-500 mb-4">
              Create teams and manage player rosters saved to Supabase.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => navigate('/teams')}
                className="btn-primary w-full"
              >
                Manage Teams & Rosters →
              </button>
              <button
                onClick={() => navigate('/games')}
                className="btn-secondary w-full"
              >
                View Cloud Games →
              </button>
            </div>
          </section>
        )}

        <button
          onClick={() => navigate('/')}
          className="btn-primary w-full mt-8"
        >
          ← Back to Home
        </button>
      </div>
    </div>
  )
}
