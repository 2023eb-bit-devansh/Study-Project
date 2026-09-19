import { useState } from "react"
import { AlertTriangle, Database, FlaskConical, Play, Search, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { ScoreBar } from "@/components/score-bar"
import { StatTile } from "@/components/stat-tile"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { usePoll } from "@/hooks/use-poll"
import { del, get, getDashboardToken, post, setDashboardToken } from "@/lib/api"
import { num } from "@/lib/format"
import type { ChunkRecord, CorpusStats } from "@/lib/types"

type PlaygroundResult = {
  claim: string
  ref_keys: string[]
  weights: Record<string, number>
  steps: { tool: string; label: string; hits: number; error?: string }[]
  sufficiency: { sufficient: boolean; gates: Record<string, boolean>; metrics: Record<string, number>; gaps: string[] }
  candidates: {
    chunk_id: string
    score: number
    components: Record<string, number>
    routes: string[]
    ref_key: string
    source_label: string
    status: string
    text: string
  }[]
}

function TokenField({ token, setToken }: { token: string; setToken: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="dash-token" className="text-xs">
        X-Dashboard-Token
      </Label>
      <Input
        id="dash-token"
        type="password"
        value={token}
        onChange={(e) => {
          setToken(e.target.value)
          setDashboardToken(e.target.value)
        }}
      />
    </div>
  )
}

function BrowseTab() {
  const [docId, setDocId] = useState("")
  const [query, setQuery] = useState("")
  const [refKey, setRefKey] = useState("")

  const params = new URLSearchParams()
  if (docId) params.set("doc_id", docId)
  if (query) params.set("q", query)
  if (refKey) params.set("ref_key", refKey)
  params.set("limit", "60")

  const { data, loading } = usePoll<{ chunks: ChunkRecord[]; count: number }>(
    () => get(`corpus/chunks?${params.toString()}`),
    0,
    [docId, query, refKey],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            placeholder="Full-text search within passages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Input
          className="w-48"
          placeholder="doc_id"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
        />
        <Input
          className="w-40 font-mono"
          placeholder="IPC:S302"
          value={refKey}
          onChange={(e) => setRefKey(e.target.value)}
        />
      </div>

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data?.chunks.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">{data.count} chunks</span>
          {data.chunks.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px]">{c.id}</span>
                {c.metadata.ref_key ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {String(c.metadata.ref_key)}
                  </Badge>
                ) : null}
                {c.metadata.ref_key_alt ? (
                  <Badge variant="outline" className="font-mono text-[11px]">
                    ↔ {String(c.metadata.ref_key_alt)}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-[11px]">
                  {String(c.metadata.status)}
                </Badge>
                {c.metadata.verification_status !== "verified" ? (
                  <Badge variant="outline" className="text-verdict-misleading text-[11px]">
                    unverified text
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-line">
                {c.document}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No chunks matched</EmptyTitle>
            <EmptyDescription>Clear the filters, or seed the corpus first.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function PlaygroundTab() {
  const [text, setText] = useState(
    "Under Section 302 of the Indian Penal Code, murder is punishable with death or imprisonment for life.",
  )
  const [wRef, setWRef] = useState(0.3)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<PlaygroundResult | null>(null)

  async function run() {
    setRunning(true)
    try {
      // Keep the weights summing to 1 as wRef moves, so the score stays
      // comparable across settings and the top score keeps its meaning.
      const rest = 1 - wRef
      const res = await post<PlaygroundResult>("corpus/search", {
        text,
        w_ref: wRef,
        w_dense: Number((rest * 0.714).toFixed(3)),
        w_exact: Number((rest * 0.286).toFixed(3)),
      })
      setResult(res)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <FlaskConical />
        <AlertTitle>Why hybrid retrieval, in one slider</AlertTitle>
        <AlertDescription>
          Run the claim below at the default reference weight of 0.30 and the section it names tops
          the list by a wide margin. Drop the weight to 0 — pure semantic search — and a
          semantically similar but legally different provision closes to within a hair. The gap
          between those two runs is the argument for exact reference lookup.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-64 flex-1 items-center gap-3">
            <Label className="shrink-0 font-mono text-xs">RANK_W_REF</Label>
            <Slider
              value={[wRef]}
              min={0}
              max={0.6}
              step={0.05}
              onValueChange={([v]) => setWRef(v)}
              className="flex-1"
            />
            <span className="tabular w-10 font-mono text-xs">{wRef.toFixed(2)}</span>
          </div>
          <Button onClick={run} disabled={running}>
            {running ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            Run retrieval
          </Button>
        </div>
      </div>

      {result ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            <span>refs: {result.ref_keys.join(", ") || "none"}</span>
            <span>sufficient: {String(result.sufficiency.sufficient)}</span>
            <span>top: {result.sufficiency.metrics.topScore}</span>
            <span>coverage: {result.sufficiency.metrics.termCoverage}</span>
          </div>

          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="w-28">Reference</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-24">Routes</TableHead>
                  <TableHead className="w-40">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.candidates.slice(0, 10).map((c, i) => (
                  <TableRow key={c.chunk_id}>
                    <TableCell className="text-muted-foreground tabular text-xs">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{c.ref_key || "—"}</TableCell>
                    <TableCell className="max-w-0 truncate text-xs">{c.source_label}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-[11px]">
                      {c.routes.join(",")}
                    </TableCell>
                    <TableCell>
                      <ScoreBar components={c.components} score={c.score} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function CorpusPage() {
  const [token, setToken] = useState(getDashboardToken())
  const [busy, setBusy] = useState(false)
  const { data, loading, refresh } = usePoll<CorpusStats>(() => get("corpus/stats"), 0)

  async function reseed() {
    setBusy(true)
    try {
      setDashboardToken(token)
      const res = await post<{ documents: number; chunks: number }>("corpus/ingest", { seed: true }, { auth: true, timeoutMs: 300_000 })
      toast.success(`Re-ingested ${res.documents} documents (${res.chunks} chunks)`)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeDoc(docId: string) {
    try {
      setDashboardToken(token)
      await del(`corpus/documents/${docId}`, { auth: true })
      toast.success(`Deleted ${docId}`)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Corpus"
        description="The curated legal corpus backing retrieval"
        actions={
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Upload data-icon="inline-start" />
                Re-ingest seed
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Re-ingest the seed corpus</DialogTitle>
                <DialogDescription>
                  Every document in <code>src/corpus/seed/documents/</code> is re-chunked,
                  re-embedded and replaced. This costs one embedding call per batch and changes
                  distances very slightly — avoid running it immediately before a demonstration.
                </DialogDescription>
              </DialogHeader>
              <TokenField token={token} setToken={setToken} />
              <DialogFooter>
                <Button onClick={reseed} disabled={busy}>
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  Re-ingest
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {data && data.unverified > 0 ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>
              {num(data.unverified)} chunks carry unverified statutory text
            </AlertTitle>
            <AlertDescription>
              The seed corpus was transcribed by hand and has not been checked against the official
              Gazette. A mistranscribed clause produces a confidently wrong <em>Supported</em>{" "}
              verdict — the one failure mode this architecture has no automated defence against.
              Run <code>npm run verify-corpus</code> for the sign-off checklist.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Chunks"
            value={data ? num(data.count) : <Skeleton className="h-6 w-12" />}
            hint={data?.collection}
          />
          <StatTile
            label="Documents"
            value={data ? num(data.documents.length) : <Skeleton className="h-6 w-12" />}
          />
          <StatTile
            label="Acts covered"
            value={data ? num(Object.keys(data.byActCode).filter((k) => k !== "—").length) : <Skeleton className="h-6 w-12" />}
            hint={data ? Object.entries(data.byActCode).filter(([k]) => k !== "—").map(([k, v]) => `${k}:${v}`).join("  ") : undefined}
          />
          <StatTile
            label="Unverified text"
            value={data ? num(data.unverified) : <Skeleton className="h-6 w-12" />}
            tone={data && data.unverified > 0 ? "warn" : "default"}
            hint="chunks needing a Gazette check"
          />
        </div>

        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="browse">Browse chunks</TabsTrigger>
            <TabsTrigger value="playground">Retrieval playground</TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Ingested documents</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {loading && !data ? (
                  <Skeleton className="mx-6 h-40" />
                ) : data?.documents.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead className="w-20">Act</TableHead>
                        <TableHead className="w-24">Type</TableHead>
                        <TableHead className="w-20 text-right">Chunks</TableHead>
                        <TableHead className="w-28">Text status</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.documents.map((d) => (
                        <TableRow key={d.doc_id}>
                          <TableCell className="text-xs">
                            {d.source_url ? (
                              <a
                                href={d.source_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="underline underline-offset-4"
                              >
                                {d.doc_title}
                              </a>
                            ) : (
                              d.doc_title
                            )}
                            <span className="text-muted-foreground ml-2 font-mono text-[11px]">
                              {d.doc_id}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{d.act_code || "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{d.doc_type}</TableCell>
                          <TableCell className="tabular text-right text-xs">{d.chunks}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={d.verification_status === "verified" ? "" : "text-verdict-misleading"}
                            >
                              {d.verification_status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${d.doc_id}`}
                              onClick={() => removeDoc(d.doc_id)}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Database />
                      </EmptyMedia>
                      <EmptyTitle>The corpus is empty</EmptyTitle>
                      <EmptyDescription>
                        Run <code>npm run seed</code> in <code>expressserver/</code>, or use
                        Re-ingest seed above.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="browse">
            <BrowseTab />
          </TabsContent>

          <TabsContent value="playground">
            <PlaygroundTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
