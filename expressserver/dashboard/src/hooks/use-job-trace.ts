import { useEffect, useRef, useState } from "react"
import type { Job, TraceEvent } from "@/lib/types"

/**
 * Live job trace over SSE, with a polled first load so a job that finished
 * before the page opened still renders. The dashboard uses SSE because a
 * trace filling in live is the clearest demonstration of the pipeline; the
 * extension polls instead, because a dropped connection there costs a user
 * their result while here it costs an F5.
 */
export function useJobTrace(jobId: string | undefined) {
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seen = useRef(new Set<number>())

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let source: EventSource | null = null

    seen.current = new Set()
    setEvents([])
    setJob(null)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/verify/${jobId}`)
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error?.message ?? `Job not found (${res.status})`)
        }
        const initial: Job = await res.json()
        if (cancelled) return
        setJob(initial)
        for (const e of initial.trace) seen.current.add(e.seq)
        setEvents(initial.trace)

        if (["done", "failed", "cancelled"].includes(initial.status)) return

        source = new EventSource(`/api/verify/${jobId}/events?since=${initial.latestSeq}`)
        source.onopen = () => setConnected(true)
        source.addEventListener("trace", (ev) => {
          const event: TraceEvent = JSON.parse((ev as MessageEvent).data)
          if (seen.current.has(event.seq)) return
          seen.current.add(event.seq)
          setEvents((prev) => [...prev, event])
        })
        source.addEventListener("end", async () => {
          source?.close()
          setConnected(false)
          const final = await fetch(`/api/verify/${jobId}`).then((r) => r.json())
          if (!cancelled) setJob(final)
        })
        source.onerror = () => {
          setConnected(false)
          source?.close()
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
      source?.close()
    }
  }, [jobId])

  return { job, events, connected, error }
}
