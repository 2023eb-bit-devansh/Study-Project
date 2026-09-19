import { useCallback, useEffect, useRef, useState } from "react"
import { fetchJob, type Job, type TraceSummary } from "./api"

/**
 * Poll a job from the side panel.
 *
 * Polling rather than SSE, deliberately: it is about fifteen lines, it needs
 * no reconnection logic, and it survives the backend being restarted
 * mid-demonstration. For a 30-90 second job, sixty small requests is nothing.
 * The interval backs off to 2s after the first 30 seconds so a long
 * verification is not making a request every second for a minute.
 */
export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<TraceSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const sinceRef = useRef(0)

  const reset = useCallback(() => {
    sinceRef.current = 0
    setJob(null)
    setEvents([])
    setError(null)
  }, [])

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    const tick = async () => {
      try {
        const next = await fetchJob(jobId, sinceRef.current)
        if (cancelled) return
        sinceRef.current = next.latestSeq
        setJob(next)
        setEvents((prev) => [...prev, ...next.trace])
        setError(null)
        if (["done", "failed", "cancelled", "awaiting_confirmation"].includes(next.status)) return
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
      }
      const elapsed = Date.now() - startedAt
      timer = setTimeout(tick, elapsed > 30_000 ? 2000 : 1000)
    }

    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId])

  return { job, events, error, reset }
}
