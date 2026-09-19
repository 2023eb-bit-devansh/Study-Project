import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { KeyRound, Play, Timer } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { JsonView } from "@/components/json-view"
import { VerdictBadge } from "@/components/verdict-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { getDashboardToken, setDashboardToken } from "@/lib/api"
import { ENDPOINTS, DEMO_CLAIMS } from "@/lib/catalog"
import { bytes, ms } from "@/lib/format"
import { cn } from "@/lib/utils"

type Outcome = {
  status: number
  statusText: string
  durationMs: number
  bytes: number
  body: unknown
  requestId: string | null
  jobId: string | null
}

export function TesterPage() {
  const [endpointId, setEndpointId] = useState("verify")
  const [params, setParams] = useState<Record<string, string>>({})
  const [query, setQuery] = useState("")
  const [body, setBody] = useState(() => JSON.stringify(ENDPOINTS[0].body ?? {}, null, 2))
  const [token, setToken] = useState(getDashboardToken())
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const endpoint = useMemo(() => ENDPOINTS.find((e) => e.id === endpointId)!, [endpointId])
  const grouped = useMemo(() => {
    const map: Record<string, typeof ENDPOINTS> = {}
    for (const e of ENDPOINTS) (map[e.group] ??= []).push(e)
    return map
  }, [])

  function selectEndpoint(id: string) {
    const next = ENDPOINTS.find((e) => e.id === id)!
    setEndpointId(id)
    setParams({})
    setQuery("")
    setBody(next.body ? JSON.stringify(next.body, null, 2) : "")
    setOutcome(null)
  }

  function resolvedPath() {
    let p = endpoint.path
    for (const name of endpoint.pathParams ?? []) {
      p = p.replace(`:${name}`, encodeURIComponent(params[name] ?? `:${name}`))
    }
    return p + (query.trim() ? (query.startsWith("?") ? query : `?${query}`) : "")
  }

  async function send() {
    setRunning(true)
    setOutcome(null)
    const started = performance.now()
    try {
      const init: RequestInit = { method: endpoint.method, headers: {} }
      if (endpoint.method !== "GET" && body.trim()) {
        try {
          JSON.parse(body)
        } catch {
          toast.error("Request body is not valid JSON")
          setRunning(false)
          return
        }
        init.body = body
        ;(init.headers as Record<string, string>)["Content-Type"] = "application/json"
      }
      if (endpoint.auth) {
        setDashboardToken(token)
        ;(init.headers as Record<string, string>)["X-Dashboard-Token"] = token
      }

      const res = await fetch(resolvedPath(), init)
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        /* keep as text */
      }
      setOutcome({
        status: res.status,
        statusText: res.statusText,
        durationMs: performance.now() - started,
        bytes: new Blob([text]).size,
        body: parsed,
        requestId: res.headers.get("X-Request-Id"),
        jobId: res.headers.get("X-Job-Id"),
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const jobId =
    outcome?.jobId ??
    (outcome?.body && typeof outcome.body === "object" && "job_id" in outcome.body
      ? String((outcome.body as { job_id: string }).job_id)
      : null)

  const label =
    outcome?.body && typeof outcome.body === "object" && "result" in outcome.body
      ? ((outcome.body as { result?: { label?: string } }).result?.label ?? null)
      : null

  return (
    <>
      <PageHeader
        title="API Tester"
        description="Build and fire requests against the backend, with the demonstration set preloaded"
      />

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Request</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="endpoint">Endpoint</FieldLabel>
                  <Select value={endpointId} onValueChange={selectEndpoint}>
                    <SelectTrigger id="endpoint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(grouped).map(([group, list]) => (
                        <SelectGroup key={group}>
                          <SelectLabel>{group}</SelectLabel>
                          {list.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              <span className="font-mono text-xs">{e.method}</span> {e.path}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{endpoint.summary}</FieldDescription>
                </Field>

                {(endpoint.pathParams ?? []).map((name) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`param-${name}`}>{name}</FieldLabel>
                    <Input
                      id={`param-${name}`}
                      value={params[name] ?? ""}
                      placeholder={name === "jobId" ? "job_…" : name}
                      onChange={(e) => setParams((p) => ({ ...p, [name]: e.target.value }))}
                    />
                  </Field>
                ))}

                <Field>
                  <FieldLabel htmlFor="query">Query string</FieldLabel>
                  <Input
                    id="query"
                    value={query}
                    placeholder="limit=20&fields=summary"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </Field>

                {endpoint.auth ? (
                  <Field>
                    <FieldLabel htmlFor="token">X-Dashboard-Token</FieldLabel>
                    <Input
                      id="token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      type="password"
                    />
                    <FieldDescription>
                      This endpoint mutates the vector store, so it requires the token from{" "}
                      <code>DASHBOARD_TOKEN</code> in <code>.env</code>.
                    </FieldDescription>
                  </Field>
                ) : null}

                {endpoint.method !== "GET" ? (
                  <Field>
                    <FieldLabel htmlFor="body">Body (JSON)</FieldLabel>
                    <Textarea
                      id="body"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={8}
                      className="font-mono text-xs"
                    />
                  </Field>
                ) : null}
              </FieldGroup>

              <Separator className="my-4" />

              <div className="flex items-center gap-2">
                <Button onClick={send} disabled={running}>
                  {running ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                  {running ? "Sending…" : "Send"}
                </Button>
                <span className="text-muted-foreground font-mono text-xs">
                  {endpoint.method} {resolvedPath()}
                </span>
              </div>
            </CardContent>
          </Card>

          {endpointId === "verify" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Demonstration set</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {DEMO_CLAIMS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="hover:bg-accent flex flex-col gap-1 rounded-md border p-3 text-left transition-colors"
                    onClick={() => setBody(JSON.stringify({ text: c.text }, null, 2))}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{c.id}</span>
                      <VerdictBadge label={c.expect} />
                    </span>
                    <span className="text-muted-foreground text-xs">{c.text}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="lg:sticky lg:top-18 lg:self-start">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              Response
              {outcome ? (
                <span className="flex items-center gap-2 font-normal">
                  <Badge
                    variant={outcome.status >= 400 ? "destructive" : "secondary"}
                    className="tabular font-mono"
                  >
                    {outcome.status} {outcome.statusText}
                  </Badge>
                  <span className="text-muted-foreground tabular flex items-center gap-1 text-xs">
                    <Timer className="size-3" />
                    {ms(outcome.durationMs)} · {bytes(outcome.bytes)}
                  </span>
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!outcome ? (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyRound />
                  </EmptyMedia>
                  <EmptyTitle>No response yet</EmptyTitle>
                  <EmptyDescription>Send a request to see the result here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {label ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">Verdict</span>
                    <VerdictBadge label={label} />
                  </div>
                ) : null}
                {jobId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs">{jobId}</span>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/trace/${jobId}`}>Watch the pipeline trace</Link>
                    </Button>
                  </div>
                ) : null}
                <JsonView value={outcome.body} maxHeight="calc(100vh - 22rem)" />
                {outcome.requestId ? (
                  <p className={cn("text-muted-foreground font-mono text-[11px]")}>
                    X-Request-Id: {outcome.requestId}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
