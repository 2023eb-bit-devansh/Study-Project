/**
 * Extension configuration.
 *
 * NO API KEYS, EVER. NFR 4.2: extension code can be read by anyone who
 * installs it, so every provider credential stays on the backend. The
 * extension knows one thing — where the backend is.
 */
export const DEFAULT_BACKEND = "http://localhost:3000"

const KEY = "backendUrl"

export async function getBackendUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(KEY)
  return (stored[KEY] as string) || DEFAULT_BACKEND
}

export async function setBackendUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: url.replace(/\/+$/, "") })
}

/** Whatever the service worker parked for the panel to pick up. */
export const PENDING_KEY = "pendingInput"

export type PendingInput =
  | { kind: "text"; text: string; sourceUrl: string | null }
  | { kind: "image"; base64: string; mimeType: string; sourceUrl: string | null }
  | { kind: "image_denied"; srcUrl: string; sourceUrl: string | null }
