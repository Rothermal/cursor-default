# AGENTS.md

## Cursor Cloud specific instructions

**StatKeeper** is a mobile-first React web app for tracking sports statistics in real time. It uses React 18 + TypeScript + Vite + Tailwind CSS 3.

### Services

| Service | Command | Port |
|---|---|---|
| Vite dev server | `pnpm dev` | 5173 |

### Key Commands

See `package.json` scripts. Standard commands:
- `pnpm dev` — start dev server (binds `0.0.0.0:5173`)
- `pnpm build` — TypeScript check + production build
- `pnpm lint` — ESLint
- `pnpm preview` — serve production build

### Gotchas

- `pnpm.onlyBuiltDependencies` in `package.json` allowlists `esbuild`; no interactive `pnpm approve-builds` needed.
- The app uses `HashRouter` (`/#/path`), not `BrowserRouter`. URLs in the browser will look like `http://localhost:5173/#/game`.
- Game state persists in `localStorage` under key `statkeeper_game`. To reset state, either use the "New Game" flow in the UI or clear localStorage.
- Sport configurations live in `src/config/sports.ts`. Adding a new sport means adding a `SportConfig` entry to the array — the UI auto-discovers it.
