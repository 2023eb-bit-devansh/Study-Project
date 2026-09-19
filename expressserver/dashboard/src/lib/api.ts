/**
 * Thin fetch wrapper for the backend API.
 *
 * In dev the Vite server proxies /api → localhost:3000, so relative URLs
 * work in both dev and the Express-served production build.
 */

export class ApiError extends Error {
  status: number
  code: string
  detail?: unknown

  constructor(message: string, status: number, code = "http_error", detail?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.detail = detail
  }
}

const TOKEN_KEY = "afc.dashboardToken"

export function getDashboardToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "change-me"
}
export function setDashboardToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

type Options = RequestInit & {
  auth?: boolean
  timeoutMs?: number
  /**
   * Statuses whose body should be returned rather than thrown. `/api/health`
   * answers 503 when a dependency is down, but the body is still the health
   * report we want to render — that is a successful probe of a sick system,
   * not a failed request.
   */
  acceptStatuses?: number[]
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { auth, timeoutMs = 30_000, headers, acceptStatuses, ...rest } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path.startsWith("/") ? path : `/api/${path}`, {
      ...rest,
      signal: opts.signal ?? controller.signal,
      headers: {
        ...(rest.body && !(rest.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(auth ? { "X-Dashboard-Token": getDashboardToken() } : {}),
        ...headers,
      },
    })
    const text = await res.text()
    let body: unknown = undefined
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    if (!res.ok && !acceptStatuses?.includes(res.status)) {
      const e = (body as { error?: { message?: string; code?: string; detail?: unknown } })?.error
      throw new ApiError(
        e?.message ?? `${res.status} ${res.statusText}`,
        res.status,
        e?.code ?? "http_error",
        e?.detail,
      )
    }
    return body as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error).name === "AbortError") {
      throw new ApiError("Request timed out", 408, "timeout")
    }
    throw new ApiError(
      (err as Error).message || "Network error — is the backend running on :3000?",
      0,
      "network_error",
    )
  } finally {
    clearTimeout(timer)
  }
}

export const get = <T,>(p: string, o?: Options) => api<T>(p, { ...o, method: "GET" })
export const post = <T,>(p: string, body?: unknown, o?: Options) =>
  api<T>(p, {
    ...o,
    method: "POST",
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
export const del = <T,>(p: string, o?: Options) => api<T>(p, { ...o, method: "DELETE" })
