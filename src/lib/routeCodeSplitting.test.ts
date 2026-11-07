import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync('src/App.tsx', 'utf8')

describe('RTN-0 route-level code splitting', () => {
  it('lazy-loads route pages so the app chunk stays under the PWA precache limit', () => {
    const eagerPages = [...app.matchAll(/^import (\w+) from '\.\/pages\/[\w/]+'$/gm)].map(match => match[1])
    // Auth and the access gate render before the app shell; the shot-chart preview is dev-only.
    expect(eagerPages.sort()).toEqual(['AppAccessGate', 'Auth', 'ShotChartPreview'])
    for (const page of ['GameTracker', 'SoccerGameTracker', 'HockeyGameTracker', 'BaseballGameTracker', 'BasketballSummary', 'Admin', 'TeamManage']) {
      expect(app).toContain(`const ${page} = lazy(() => import('./pages/${page}'))`)
    }
  })

  it('wraps every route table in the chunk boundary', () => {
    expect(app.split('<Routes>').length - 1).toBe(2)
    expect(app.split('<RouteChunkBoundary>').length - 1).toBe(2)
  })
})
