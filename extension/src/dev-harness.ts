/**
 * Minimal chrome.* stub so the side panel can be rendered in an ordinary
 * browser tab during development. Loaded only by dev-harness.html, which is
 * not a build input and never ships.
 */
const session = new Map<string, unknown>()
const local = new Map<string, unknown>()

const area = (store: Map<string, unknown>) => ({
  get: async (key: string | string[] | null) => {
    if (key === null || key === undefined) return Object.fromEntries(store)
    const keys = Array.isArray(key) ? key : [key]
    return Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)]))
  },
  set: async (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) store.set(k, v)
  },
  remove: async (key: string) => { store.delete(key) },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).chrome = {
  storage: {
    session: area(session),
    local: area(local),
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: { openOptionsPage: () => window.open("/options.html", "_blank") },
}
console.info("[dev-harness] chrome.* stubbed — this file never ships")
