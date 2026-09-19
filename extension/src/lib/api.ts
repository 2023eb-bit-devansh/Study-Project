import { getBackendUrl } from "./config"

export type Stage =
  | "input" | "claim_extraction" | "retrieval" | "verdict" | "citation" | "assembly"

export type TraceSummary = {
  seq: number
  ts: string
  stage: Stage
  type: string
  label: string
  sub_claim_id: string | null
}

export type JobStatus =
  | "queued" | "running" | "awaiting_confirmation" | "done" | "failed" | "cancelled"

export type EvidenceItem = {
  evidence_id: string
  source_label: string
  source_url: string | null
  source_type: string
  status_meta: string | null
  passage: string
  stance: "supporting" | "contradicting" | "neutral"
  verbatim_quote: string
  reasoning: string
  citation: {
    status: "verified" | "partially_verified" | "rejected"
    tier: string
    similarity: number
    guards_fired: string[]
    reason: string
    span: { start: number; end: number } | null
  }
}

export type SubClaim = {
  id: string
  text: string
  label: string
  rule_id: string
  explanation: string
  ref_keys: string[]
  evidence: EvidenceItem[]
  retrieval: { sufficiency: string; gaps: string[]; web_used: boolean }
}

export type VerifyResult = {
  label: string
  explanation: string
  sub_claims: SubClaim[]
  skipped_claims: { text: string; checkability: string; checkability_reason: string }[]
  disclaimer: string
  replay?: boolean
}

export type Job = {
  id: string
  status: JobStatus
  latestSeq: number
  transcription: {
    transcribed_text: string
    legibility: string
    illegible_spans: string[]
    layout_note: string
  } | null
  result: VerifyResult | null
  error: { code: string; message: string } | null
  trace: TraceSummary[]
}

export class BackendError extends Error {
  code: string
  constructor(message: string, code = "error") {
    super(message)
    this.code = code
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBackendUrl()
  let res: Response
  try {
    res = await fetch(`${base}${path}`, init)
  } catch {
    throw new BackendError(
      `Could not reach the backend at ${base}. Is it running?`,
      "unreachable",
    )
  }
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const e = (body as { error?: { message?: string; code?: string } })?.error
    throw new BackendError(e?.message ?? `${res.status} ${res.statusText}`, e?.code ?? "http_error")
  }
  return body as T
}

export function createTextJob(text: string, sourceUrl: string | null) {
  return call<{ job_id: string }>("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sourceUrl }),
  })
}

export function createImageJob(base64: string, mimeType: string, sourceUrl: string | null) {
  return call<{ job_id: string }>("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: base64, mimeType, sourceUrl }),
  })
}

/** `fields=summary` keeps every `detail` payload off the wire to the panel. */
export function fetchJob(jobId: string, since: number) {
  return call<Job>(`/api/verify/${jobId}?fields=summary&since=${since}`)
}

export function confirmJob(jobId: string, correctedText: string) {
  return call<{ job_id: string }>(`/api/verify/${jobId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corrected_text: correctedText }),
  })
}

export function cancelJob(jobId: string) {
  return call<{ job_id: string }>(`/api/verify/${jobId}/cancel`, { method: "POST" })
}

export function fetchHealth() {
  return call<{ status: string; checks: Record<string, { ok: boolean; label: string; detail: string; warn?: boolean }> }>(
    "/api/health",
  )
}
