import { render } from 'preact'
import '@tik-choco/mistai/ui.css'
import './index.css'
import { App } from './app.tsx'
import { AppSettingsProvider } from './hooks/useAppSettings'
import { loadAppSettings } from './lib/appSettings'
import { writeAppManifest } from './lib/appManifest'
import { BUS_VERSION } from './lib/sharedBus'

// Applied synchronously before the first paint so there's no flash of the
// wrong theme while waiting for AppSettingsProvider's effect to run —
// AppSettingsProvider re-applies it on mount (and on every change), this is
// just to win the race against the initial render.
const initialTheme = loadAppSettings().theme
if (initialTheme !== 'system') {
  document.documentElement.setAttribute('data-theme', initialTheme)
}

render(
  <AppSettingsProvider>
    <App />
  </AppSettingsProvider>,
  document.getElementById('app')!,
)

// protocol の app-manifest.md 参照: 他アプリからの自己申告キャッシュとして起動を記録する
writeAppManifest({
  app: 'tc-note',
  busVersion: BUS_VERSION,
  publishes: ['note-article', 'storage-drive-inbox', 'note-doc-index'],
  consumes: ['ocr-markdown-index', 'note-inbox'],
  reads: ['tc-translate-history-v1'],
})
