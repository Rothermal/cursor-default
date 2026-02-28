## StatKeeper – GitHub Pages Deployment

This guide shows how to deploy StatKeeper to **GitHub Pages** as a project site at `https://username.github.io/cursor-default/` using **GitHub Actions**.

Replace `username` with your actual GitHub username.

---

## 1. One‑time project configuration

### 1.1 Ensure Vite base path is set

In `vite.config.ts`, Vite should build with the project path `/cursor-default/`, and the PWA `scope` / `start_url` should also use `/cursor-default/`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cursor-default/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'StatKeeper',
        short_name: 'StatKeeper',
        description: 'Track sports game stats in real time',
        theme_color: '#1e293b',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/cursor-default/',
        start_url: '/cursor-default/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
}))
```

> If your repo name is not `cursor-default`, change `/cursor-default/` to `/<your-repo-name>/` everywhere above.

### 1.2 Add the GitHub Actions workflow

Create `.github/workflows/deploy.yml` with the following contents:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Commit and push:

```bash
git add vite.config.ts .github/workflows/deploy.yml GITHUB_PAGES_DEPLOY.md
git commit -m "Set up GitHub Pages deployment"
git push
```

---

## 2. Configure GitHub Pages in the repo

1. Go to your GitHub repo in the browser.
2. Navigate to **Settings → Pages**.
3. Under **Source**, choose **GitHub Actions** (not a branch).
4. Save the settings.

GitHub will now expect a workflow (like `deploy.yml`) to publish the site.

---

## 3. Trigger a deployment

1. Push to the `main` branch (or use **Actions → Deploy to GitHub Pages → Run workflow**).
2. Open the **Actions** tab and wait for the **Deploy to GitHub Pages** workflow to finish successfully.
3. Return to **Settings → Pages** to see the published URL.

For a project site it will be:

- `https://username.github.io/cursor-default/`

---

## 4. Test the deployed app

1. Open the Pages URL in your browser.
2. Confirm:
   - The app loads and routes work (URLs like `https://username.github.io/cursor-default/#/game`).
   - Assets (JS/CSS) load without 404s.
3. On your phone:
   - Open the same URL.
   - Use **Add to Home Screen** / **Install app** in the browser menu to install the PWA.

After this, every push to `main` will automatically rebuild and redeploy StatKeeper to GitHub Pages.

---

## Notes about local URLs

- `pnpm dev` will run at `http://localhost:5173/` (no `/cursor-default/` prefix).
- `pnpm preview` serves the production build, so open `http://localhost:4173/cursor-default/`.

