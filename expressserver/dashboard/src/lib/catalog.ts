/** The endpoint catalog behind the API Tester. */
export type Endpoint = {
  id: string
  method: "GET" | "POST" | "DELETE"
  path: string
  summary: string
  auth?: boolean
  body?: unknown
  pathParams?: string[]
  group: string
}

export const DEMO_CLAIMS: { id: string; label: string; expect: string; text: string }[] = [
  {
    id: "T0",
    label: "T0 — Not Checkable",
    expect: "Not Checkable",
    text: "Section 302 IPC is far too harsh and should be abolished.",
  },
  {
    id: "T1",
    label: "T1 — Supported",
    expect: "Supported",
    text: "Under Section 302 of the Indian Penal Code, murder is punishable with death or imprisonment for life.",
  },
  {
    id: "T2",
    label: "T2 — Contradicted",
    expect: "Contradicted",
    text: "Section 66A of the Information Technology Act, 2000 makes sending offensive messages online punishable with up to three years' imprisonment, and it is still in force today.",
  },
  {
    id: "T3",
    label: "T3 — Misleading Context",
    expect: "Misleading Context",
    text: "The Right to Information Act gives any citizen the right to obtain information from any public authority.",
  },
  {
    id: "T4",
    label: "T4 — Insufficient Evidence",
    expect: "Insufficient Evidence",
    text: "In 2023 the Bombay High Court held in Criminal Appeal No. 412 of 2019 that a dying declaration recorded by a police constable is inadmissible.",
  },
]

export const ENDPOINTS: Endpoint[] = [
  {
    id: "verify",
    method: "POST",
    path: "/api/verify",
    group: "Verification",
    summary: "Create a verification job from a text claim. Returns 202 with a job id to poll.",
    body: { text: DEMO_CLAIMS[1].text },
  },
  {
    id: "verify-get",
    method: "GET",
    path: "/api/verify/:jobId",
    group: "Verification",
    summary: "Job status, result and full trace. Add ?fields=summary&since=N for the extension's projection.",
    pathParams: ["jobId"],
  },
  {
    id: "verify-list",
    method: "GET",
    path: "/api/verify",
    group: "Verification",
    summary: "Recent jobs held in the in-memory ring buffer.",
  },
  {
    id: "verify-confirm",
    method: "POST",
    path: "/api/verify/:jobId/confirm",
    group: "Verification",
    summary: "Resume an image job parked at awaiting_confirmation with corrected OCR text.",
    pathParams: ["jobId"],
    body: { corrected_text: "" },
  },
  {
    id: "verify-cancel",
    method: "POST",
    path: "/api/verify/:jobId/cancel",
    group: "Verification",
    summary: "Cooperative cancel, checked between pipeline stages.",
    pathParams: ["jobId"],
  },
  {
    id: "health",
    method: "GET",
    path: "/api/health",
    group: "System",
    summary: "Chroma reachability, collection size, $regex capability, resolved Gemini models.",
  },
  {
    id: "config",
    method: "GET",
    path: "/api/config",
    group: "System",
    summary: "Every resolved model id and threshold, secrets redacted.",
  },
  {
    id: "metrics",
    method: "GET",
    path: "/api/metrics",
    group: "System",
    summary: "Rolling latency percentiles and status counts over the request ring.",
  },
  {
    id: "requests",
    method: "GET",
    path: "/api/requests",
    group: "System",
    summary: "Captured requests. ?limit, ?since, ?path, ?status.",
  },
  {
    id: "corpus-stats",
    method: "GET",
    path: "/api/corpus/stats",
    group: "Corpus",
    summary: "Chunk counts by act, document type and status.",
  },
  {
    id: "corpus-chunks",
    method: "GET",
    path: "/api/corpus/chunks",
    group: "Corpus",
    summary: "Browse chunks. ?doc_id, ?act_code, ?ref_key, ?q (full-text), ?limit, ?offset.",
  },
  {
    id: "corpus-seed",
    method: "GET",
    path: "/api/corpus/seed",
    group: "Corpus",
    summary: "The seed documents on disk, whether or not they have been ingested.",
  },
  {
    id: "corpus-ingest",
    method: "POST",
    path: "/api/corpus/ingest",
    group: "Corpus",
    auth: true,
    summary: "Ingest documents. Send {seed:true} to re-ingest the bundled seed corpus.",
    body: { seed: true },
  },
  {
    id: "corpus-delete",
    method: "DELETE",
    path: "/api/corpus/documents/:docId",
    group: "Corpus",
    auth: true,
    summary: "Delete a document's chunks and its stored source text.",
    pathParams: ["docId"],
  },
  {
    id: "runs",
    method: "GET",
    path: "/api/runs",
    group: "Runs",
    summary: "Finished runs from the durable JSONL log (FR20).",
  },
]
