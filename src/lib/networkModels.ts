// Helper for recognizing the `mist-network://` pseudo-provider convention
// used by the tik-choco family's shared LLM config (tc-shared-llm-config-v1).
// Ported (isNetworkProviderBaseUrl only — tc-note doesn't itself mirror AI
// Network-discovered models into the shared config the way tc-translate's
// useNetworkModelSync.ts does) from tc-translate's src/lib/networkModels.ts;
// see tc-docs/drafts/llm-settings-common-v1.md §2.2 for the full convention.
//
// Even though tc-note never writes a `mist-network://` provider/preset
// itself, `providers`/`presets` are a co-owned record shared by every
// tik-choco app on the same origin (llmConfig.ts) — so an entry another app
// (tc-translate, tc-news, tc-lingo, ...) synced in from its own AI Network
// room shows up here too. `isNetworkProviderBaseUrl` lets the Connection/
// Tasks tabs recognize and visually distinguish that origin, same as those
// other apps do.
export const NETWORK_PROVIDER_LABEL = "AI Network";
export const NETWORK_PROVIDER_URL_PREFIX = "mist-network://";

export function isNetworkProviderBaseUrl(baseUrl: string): boolean {
  return baseUrl.trim().startsWith(NETWORK_PROVIDER_URL_PREFIX);
}
