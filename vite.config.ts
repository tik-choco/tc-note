/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The mist engine normally comes from npm (@tik-choco/mistlib). Point
  // MISTLIB_LOCAL at a local `wasm-pack build` output (mistlib-dev's
  // mistlib-wasm/pkg) in .env to run against an engine you're editing.
  //
  // An alias rather than an npm install so switching leaves package.json and
  // the lockfile untouched — there's nothing to remember to revert. The
  // trade-off: this only redirects Vite (dev, build, and vitest, which reads
  // this same config). `tsc` keeps reading types from node_modules, so if the
  // engine's API itself changed, install the local build instead:
  //   npm i "@tik-choco/mistlib@file:../mistlib-dev/mistlib-wasm/pkg"
  //
  // '' as the prefix: loadEnv only exposes VITE_-prefixed keys by default, and
  // MISTLIB_LOCAL is build-time config that must never reach client code.
  const localEngine = loadEnv(mode, process.cwd(), '').MISTLIB_LOCAL
  const alias: Record<string, string> = {}
  if (localEngine) {
    alias['@tik-choco/mistlib'] = path.resolve(process.cwd(), localEngine)
    console.log(`vite: using local mist engine at ${alias['@tik-choco/mistlib']}`)
  }

  // Deploys under /tc-note/ on GitHub Pages (VITE_BASE_PATH — see CLAUDE.md
  // "Deployment") but runs at '/' locally. The PWA manifest's start_url/
  // scope must track this same value — an installed PWA built from the
  // GitHub Pages build would otherwise register itself scoped to the origin
  // root instead of /tc-note/, breaking install/launch there.
  const base = process.env.VITE_BASE_PATH || '/'

  return {
  base,
  plugins: [
    preact(),
    VitePWA({
      // Explicit "update available" prompt (see src/components/
      // PwaUpdatePrompt.tsx) rather than autoUpdate's silent reload, which
      // could yank a mid-edit note out from under the user.
      registerType: 'prompt',
      // No service worker / precache in dev — `npm run dev` behaves exactly
      // as it did before this plugin was added.
      devOptions: { enabled: false },
      manifest: {
        name: 'TC Note',
        short_name: 'TC Note',
        description:
          'TC Note — a block-based markdown note app with collaboration and PDF import',
        lang: 'ja',
        display: 'standalone',
        start_url: base,
        scope: base,
        // Light-theme surface/accent (src/index.css :root) — the dark theme
        // overrides don't apply here since the manifest is static.
        background_color: '#ffffff',
        theme_color: '#0d9488',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // The mist engine (@tik-choco/mistlib) ships a ~1.4MB wasm binary
        // and the app's largest JS bundle already sits just past Workbox's
        // 2MiB default ceiling — raise it with headroom for both to keep
        // getting precached as the app grows.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias },
  test: {
    // Vitest's default excludes don't cover dotfolders like .claude/ — without
    // this, `npm test` from the repo root also picks up and re-runs every
    // test file inside any git worktree checked out under .claude/worktrees/
    // (e.g. background agents working in parallel), which is slow and makes
    // failures there look like failures here.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.git/**'],
  },
  }
})
