import { useCallback, useEffect, useRef, useState } from "react"

type State<T> = { data: T | null; error: Error | null; loading: boolean }

/**
 * Poll an async loader on an interval, with the first load flagged as
 * `loading` and subsequent refreshes silent so the table does not flash.
 * Pass `intervalMs: 0` for a one-shot load.
 */
export function usePoll<T>(
  loader: () => Promise<T>,
  intervalMs = 5000,
  deps: unknown[] = [],
): State<T> & { refresh: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        const data = await loaderRef.current()
        if (!cancelled) setState({ data, error: null, loading: false })
      } catch (err) {
        if (!cancelled) setState((s) => ({ data: s.data, error: err as Error, loading: false }))
      }
      if (!cancelled && intervalMs > 0) timer = setTimeout(run, intervalMs)
    }

    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, nonce, ...deps])

  return { ...state, refresh }
}
