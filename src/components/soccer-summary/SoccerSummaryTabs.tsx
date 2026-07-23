export default function SoccerSummaryTabs() {
  return (
    <nav
      className="border-b border-slate-200 bg-white"
      aria-label="Summary sections"
    >
      <div className="mx-auto flex h-12 max-w-2xl items-stretch px-4">
        <button
          type="button"
          className="border-b-2 border-emerald-700 px-2 text-sm font-bold text-emerald-800"
          aria-current="page"
        >
          Overview
        </button>
      </div>
    </nav>
  )
}
