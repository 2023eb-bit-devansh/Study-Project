/** Shapes mirrored from the backend. Kept hand-written and small on purpose. */

export type HealthCheck = {
  ok: boolean
  label: string
  detail: string
  warn?: boolean
  warnDetail?: string
  meta?: Record<string, unknown>
}

export type Health = {
  status: "ok" | "degraded" | "down"
  version: string
  uptimeSec: number
  node: string
  checks: Record<string, HealthCheck>
}

export type Metrics = {
  windowMs: number
  ringSize: number
  count: number
  errors: number
  errorRate: number
  latency: { p50: number; p95: number; p99: number; max: number; avg: number }
  byStatus: Record<string, number>
  byPath: { key: string; count: number; errors: number; avgMs: number; maxMs: number }[]
}

export type RequestEntry = {
  seq: number
  id: string
  ts: string
  method: string
  path: string
  query: Record<string, string> | null
  status: number
  durationMs: number
  stream: boolean
  requestHeaders: Record<string, string>
  requestBody: BodyCapture | null
  responseBody: BodyCapture | null
  responseBytes: number | null
  jobId: string | null
  error: string | null
}

export type BodyCapture =
  | { kind: "json"; json: unknown; bytes: number; truncated: boolean }
  | { kind: "text"; preview: string; bytes: number; truncated: boolean }
  | { kind: "binary"; bytes: number }
  | { kind: "unserializable" }

export type ConfigEntry = {
  value: unknown
  type: string
  isDefault: boolean
  secret: boolean
}

export type ConfigResponse = {
  groups: Record<string, Record<string, ConfigEntry>>
  groupOrder: string[]
  resolvedModels: {
    source: string
    extraction: string | null
    vision: string | null
    retrieval: string | null
    verdict: string | null
    grounding: string | null
    embed: string | null
    warnings?: string[]
    available?: { name: string; methods: string[]; inputTokenLimit: number | null }[]
  }
}

export type VerdictLabel =
  | "Supported"
  | "Contradicted"
  | "Misleading Context"
  | "Insufficient Evidence"
  | "Not Checkable"

export type Stage =
  | "input"
  | "claim_extraction"
  | "retrieval"
  | "verdict"
  | "citation"
  | "assembly"

export type TraceType =
  | "stage_start"
  | "stage_end"
  | "tool_call"
  | "tool_result"
  | "llm_call"
  | "llm_result"
  | "decision"
  | "progress"
  | "warning"
  | "error"

export type TraceEvent = {
  seq: number
  job_id: string
  ts: string
  stage: Stage
  type: TraceType
  label: string
  sub_claim_id?: string | null
  detail?: unknown
  duration_ms?: number
  tokens?: { prompt: number; output: number; total: number }
  cost_estimate_usd?: number
  budget?: Record<string, number>
}

export type JobStatus =
  | "queued"
  | "running"
  | "awaiting_confirmation"
  | "done"
  | "failed"
  | "cancelled"

export type CitationStatus = "verified" | "partially_verified" | "rejected"

export type EvidenceItem = {
  evidence_id: string
  source_label: string
  source_url: string | null
  source_type: "corpus" | "web" | "web_unverifiable"
  status_meta: string | null
  passage: string
  stance: "supporting" | "contradicting" | "neutral"
  claim_span: string
  verbatim_quote: string
  reasoning: string
  retrieval_score: number
  score_components: Record<string, number> | null
  citation: {
    status: CitationStatus
    tier: "exact" | "normalized" | "fuzzy" | "none"
    similarity: number
    guards_fired: string[]
    reason?: string
    span?: { start: number; end: number } | null
    attempt: number
  }
}

export type SubClaimResult = {
  id: string
  text: string
  claim_type: string
  checkability: string
  checkability_reason?: string
  ref_keys: string[]
  label: VerdictLabel
  rule_id: string
  explanation: string
  provisional_verdict: VerdictLabel | null
  evidence: EvidenceItem[]
  decision: {
    label: VerdictLabel
    rule_id: string
    inputs: Record<string, unknown>
    thresholds: Record<string, number | boolean>
  }
  retrieval: {
    sufficiency: string
    gaps: string[]
    turns: number
    tool_calls: number
    web_used: boolean
    stop_reason: string
    metrics: Record<string, number>
    gates: Record<string, boolean>
  }
}

export type VerifyResult = {
  label: VerdictLabel
  explanation: string
  sub_claims: SubClaimResult[]
  skipped_claims: { text: string; checkability: string; checkability_reason: string }[]
  disclaimer: string
  replay?: boolean
}

export type Job = {
  id: string
  status: JobStatus
  createdAt: string
  updatedAt: string
  input: { kind: "text" | "image"; text?: string; sourceUrl?: string | null; mimeType?: string }
  transcription?: {
    transcribed_text: string
    legibility: "high" | "medium" | "low"
    illegible_spans: string[]
    layout_note: string
  } | null
  result: VerifyResult | null
  error: { code: string; message: string } | null
  trace: TraceEvent[]
  latestSeq: number
  usage: { calls: number; promptTokens: number; outputTokens: number; costUsd: number }
  timings: Partial<Record<Stage, number>>
  replay: boolean
}

export type ChunkRecord = {
  id: string
  document: string
  metadata: Record<string, string | number | boolean>
}

export type CorpusStats = {
  collection: string
  count: number
  documents: { doc_id: string; doc_title: string; doc_type: string; act_code: string; chunks: number; verification_status: string; source_url: string }[]
  byActCode: Record<string, number>
  byDocType: Record<string, number>
  byStatus: Record<string, number>
  unverified: number
}
