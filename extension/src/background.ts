/**
 * MV3 service worker.
 *
 * It does three things and deliberately no more: register the context menus,
 * open the side panel on a user gesture, and turn a right-clicked image into
 * base64.
 *
 * IT NEVER POLLS. An MV3 worker is terminated after 30 seconds idle, and —
 * more sharply — a single `fetch()` that waits more than 30 seconds for a
 * response kills it outright. A verification takes 30-90 seconds, so driving
 * and polling the job here would be unreliable by construction. The side
 * panel is a real document with a real lifetime, so it owns the job. This is
 * the mitigation the Phase 2 spec names in risk R8.
 */
import { PENDING_KEY, type PendingInput } from "./lib/config"

const MENU_TEXT = "afc-check-selection"
const MENU_IMAGE = "afc-check-image"

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TEXT,
      title: 'Fact-check "%s"',
      contexts: ["selection"],
    })
    chrome.contextMenus.create({
      id: MENU_IMAGE,
      title: "Fact-check the claim in this image",
      contexts: ["image"],
    })
  })
  // With this true, Chrome consumes the toolbar click itself, so there is no
  // chrome.action.onClicked handler here — it would never fire.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // `open()` MUST be the first statement. Any await before it breaks the
  // user-gesture chain and Chrome rejects the call.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
  void handleMenuClick(info)
})

async function handleMenuClick(info: chrome.contextMenus.OnClickData) {
  if (info.menuItemId === MENU_TEXT && info.selectionText) {
    await park({
      kind: "text",
      text: info.selectionText,
      sourceUrl: info.pageUrl ?? null,
    })
    return
  }

  if (info.menuItemId === MENU_IMAGE && info.srcUrl) {
    // Fetching an arbitrary image needs broad host access, which conflicts
    // with NFR 4.2's minimal-permissions requirement. So it is an OPTIONAL
    // permission, requested the first time the user actually uses the image
    // action. If declined, the panel falls back to file upload.
    const origin = originOf(info.srcUrl)
    const granted = origin
      ? await chrome.permissions.contains({ origins: [origin] })
      : true

    if (!granted && origin) {
      const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false)
      if (!ok) {
        await park({ kind: "image_denied", srcUrl: info.srcUrl, sourceUrl: info.pageUrl ?? null })
        return
      }
    }

    try {
      const { base64, mimeType } = await imageUrlToBase64(info.srcUrl)
      await park({ kind: "image", base64, mimeType, sourceUrl: info.pageUrl ?? null })
    } catch {
      await park({ kind: "image_denied", srcUrl: info.srcUrl, sourceUrl: info.pageUrl ?? null })
    }
  }
}

/**
 * `chrome.storage.session` rather than a global: any global this worker sets
 * is lost when it shuts down, which it will.
 */
async function park(input: PendingInput) {
  await chrome.storage.session.set({ [PENDING_KEY]: { ...input, at: Date.now() } })
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null // data: / blob:
    return `${u.protocol}//${u.hostname}/*`
  } catch {
    return null
  }
}

/**
 * Fetch an image and base64-encode it.
 *
 * The chunking is not optional. `String.fromCharCode.apply(null, bytes)`
 * spreads every byte as a separate argument, and Chrome's ~125k argument
 * limit means any image over roughly 120 KB throws
 * "RangeError: Maximum call stack size exceeded".
 *
 * `subarray` returns a view; `slice` would copy the whole image again.
 *
 * Doing this in the worker also sidesteps page CORS entirely — a
 * cross-origin fetch from an extension service worker with host permission
 * needs no preflight and no Access-Control-Allow-Origin. A content-script
 * canvas is not an alternative: cross-origin images taint it.
 */
async function imageUrlToBase64(srcUrl: string) {
  const res = await fetch(srcUrl)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0]
  const bytes = new Uint8Array(await res.arrayBuffer())

  const CHUNK = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return { base64: btoa(binary), mimeType }
}
