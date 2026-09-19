import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle, ChevronRight, CircleDot, FileText, GitBranch, Quote, Scale, Search, ShieldCheck,
} from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { JsonView } from "@/components/json-view"
import { ScoreBar } from "@/components/score-bar"
import { DecisionTable } from "@/components/decision-table"
import { CitationBadge, StanceBadge, VerdictBadge } from "@/components/verdict-badge"
import { StatusDot } from "@/components/layout/status-dot"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { useJobTrace } from "@/hooks/use-job-trace"
import { usePoll } from "@/hooks/use-poll"
import { get } from "@/lib/api"
import { ms, num, relTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Job, Stage, SubClaimResult, TraceEvent } from "@/lib/types"

const STAGE_META: Record<Stage, { label: string; icon: typeof Search }> = {
  input: { label: "Input", icon: FileText },
  claim_extraction: { label: "Claim extraction", icon: Scale },
  retrieval: { label: "Retrieval", icon: Search },
  verdict: { label: "Verdict", icon: GitBranch },
  citation: { label: "Citation check", icon: Quote },
  assembly: { label: "Assembly", icon: ShieldCheck },
}
const STAGE_ORDER = Object.keys(STAGE_META) as Stage[]

function typeTone(type: string) {
  if (type === "error") return "text-verdict-contradicted"
  if (type === "warning") return "text-verdict-misleading"
  if (type === "decision") return "text-foreground font-medium"
  return "text-muted-foreground"
}

function EventRow({ event }: { event: TraceEvent }) {
  const [open, setOpen] = useState(false)
  const hasDetail = event.detail !== undefined && event.detail !== null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-start gap-2 py-1.5">
        <span className="text-muted-foreground tabular w-8 shrink-0 pt-0.5 text-right font-mono text-[11px]">
          {event.seq}
        </span>
        <CollapsibleTrigger asChild disabled={!hasDetail}>
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-start gap-2 text-left",
              hasDetail && "cursor-pointer",
            )}
          >
            <ChevronRight
              className={cn(
                "text-muted-foreground mt-0.5 size-3 shrink-0 transition-transform",
                open && "rotate-90",
                !hasDetail && "opacity-0",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("text-xs", typeTone(event.type))}>{event.label}</span>
              <span className="text-muted-foreground ml-2 font-mono text-[11px]">{event.type}</span>
              {event.sub_claim_id ? (
                <span className="text-muted-foreground ml-1 font-mono text-[11px]">
                  {event.sub_claim_id}
                </span>
              ) : null}
            </span>
            {event.duration_ms !== undefined ? (
              <span className="text-muted-foreground tabular shrink-0 font-mono text-[11px]">
                {ms(event.duration_ms)}
              </span>
            ) : null}
            {event.tokens ? (
              <span className="text-muted-foreground tabular shrink-0 font-mono text-[11px]">
                {num(event.tokens.total || event.tokens.prompt + event.tokens.output)} tok
              </span>
            ) : null}
          </button>
        </CollapsibleTrigger>
      </div>
      {hasDetail ? (
        <CollapsibleContent className="pb-2 pl-12">
          <JsonView value={event.detail} maxHeight="20rem" />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function StageStrip({ events, job }: { events: TraceEvent[]; job: Job | null }) {
  const reached = new Set(events.map((e) => e.stage))
  const failed = events.some((e) => e.type === "error")
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STAGE_ORDER.map((stage, i) => {
        const meta = STAGE_META[stage]
        const done = reached.has(stage)
        const durations = job?.timings?.[stage]
        return (
          <div key={stage} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                done ? "border-border" : "border-dashed opacity-50",
              )}
            >
              <meta.icon className="size-3" />
              <span>{meta.label}</span>
              {durations ? (
                <span className="text-muted-foreground tabular font-mono text-[11px]">
                  {ms(durations)}
                </span>
              ) : null}
            </div>
            {i < STAGE_ORDER.length - 1 ? (
              <ChevronRight className="text-muted-foreground size-3" />
            ) : null}
          </div>
        )
      })}
      {failed ? (
        <Badge variant="destructive" className="ml-2">
          error
        </Badge>
      ) : null}
    </div>
  )
}

function SubClaimCard({ sub }: { sub: SubClaimResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground font-mono text-xs">{sub.id}</span>
          <VerdictBadge label={sub.label} />
          <Badge variant="outline" className="font-mono text-[11px]">
            {sub.rule_id}
          </Badge>
          {sub.ref_keys.map((k) => (
            <Badge key={k} variant="secondary" className="font-mono text-[11px]">
              {k}
            </Badge>
          ))}
          {sub.retrieval.web_used ? <Badge variant="outline">live search</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{sub.text}</p>
        <p className="text-muted-foreground text-xs">{sub.explanation}</p>

        {sub.provisional_verdict && sub.provisional_verdict !== sub.label ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>
              The model's unconstrained read differed from the evidence-gated verdict
            </AlertTitle>
            <AlertDescription>
              It proposed <strong>{sub.provisional_verdict}</strong>; the decision table returned{" "}
              <strong>{sub.label}</strong> from the citations that actually survived verification.
            </AlertDescription>
          </Alert>
        ) : null}

        <div>
          <h3 className="mb-2 text-xs font-medium">Retrieval</h3>
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            <span>sufficiency: {sub.retrieval.sufficiency}</span>
            <span>turns: {sub.retrieval.turns}</span>
            <span>tool calls: {sub.retrieval.tool_calls}</span>
            <span>stop: {sub.retrieval.stop_reason}</span>
          </div>
          {sub.retrieval.gaps.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {sub.retrieval.gaps.map((g) => (
                <Badge key={g} variant="outline" className="font-mono text-[11px]">
                  {g}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {sub.evidence.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-medium">Evidence and citation checks</h3>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">ID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-24">Stance</TableHead>
                    <TableHead className="w-32">Citation</TableHead>
                    <TableHead className="w-36">Retrieval score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sub.evidence.map((e) => (
                    <TableRow key={e.evidence_id}>
                      <TableCell className="font-mono text-xs">{e.evidence_id}</TableCell>
                      <TableCell className="max-w-0 truncate text-xs">
                        {e.source_url ? (
                          <a
                            href={e.source_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-4"
                          >
                            {e.source_label}
                          </a>
                        ) : (
                          e.source_label
                        )}
                      </TableCell>
                      <TableCell>
                        <StanceBadge stance={e.stance} />
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-col gap-1">
                          <CitationBadge status={e.citation.status} />
                          <span className="text-muted-foreground tabular font-mono text-[11px]">
                            {e.citation.tier} · {e.citation.similarity.toFixed(3)}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <ScoreBar components={e.score_components} score={e.retrieval_score} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {sub.evidence.map((e) => (
                <div key={e.evidence_id} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{e.evidence_id}</span>
                    <CitationBadge status={e.citation.status} />
                    {e.citation.guards_fired.map((g) => (
                      <Badge key={g} variant="outline" className="font-mono text-[11px]">
                        {g}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
                    <HighlightedPassage passage={e.passage} span={e.citation.span} />
                  </p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">quote: </span>
                    <span className="font-mono">{e.verbatim_quote}</span>
                  </p>
                  {e.citation.reason ? (
                    <p className="text-muted-foreground mt-1 text-xs">{e.citation.reason}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Alert>
            <ShieldCheck />
            <AlertTitle>No evidence was retrieved, so the verdict model was never called</AlertTitle>
            <AlertDescription>
              This is the evidence-first rule: an empty evidence set returns Insufficient Evidence
              directly, at zero model cost.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <h3 className="mb-2 text-xs font-medium">Decision</h3>
          <DecisionTable ruleId={sub.rule_id} inputs={sub.decision?.inputs} />
        </div>
      </CardContent>
    </Card>
  )
}

/** Wash the verified run of text inside the real passage. */
function HighlightedPassage({
  passage,
  span,
}: {
  passage: string
  span: { start: number; end: number } | null | undefined
}) {
  if (!span || span.start >= span.end || span.end > passage.length) return <>{passage}</>
  return (
    <>
      {passage.slice(0, span.start)}
      <mark className="verified-span">{passage.slice(span.start, span.end)}</mark>
      {passage.slice(span.end)}
    </>
  )
}

export function TracePage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState("")
  const { job, events, connected, error } = useJobTrace(jobId)
  const recent = usePoll<{ jobs: { id: string; status: string; preview: string; label: string | null; createdAt: string }[] }>(
    () => get("verify?limit=20"),
    jobId ? 0 : 5000,
  )

  if (!jobId) {
    return (
      <>
        <PageHeader title="Trace" description="Per-request view of every pipeline stage" />
        <div className="flex flex-col gap-4 p-4">
          <form
            className="flex max-w-lg gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (input.trim()) navigate(`/trace/${input.trim()}`)
            }}
          >
            <Input
              placeholder="job_…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="font-mono"
            />
            <Button type="submit">Open</Button>
          </form>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent jobs</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {recent.data?.jobs.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-52">Job</TableHead>
                      <TableHead>Claim</TableHead>
                      <TableHead className="w-44">Verdict</TableHead>
                      <TableHead className="w-24 text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.data.jobs.map((j) => (
                      <TableRow
                        key={j.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/trace/${j.id}`)}
                      >
                        <TableCell className="font-mono text-xs">{j.id}</TableCell>
                        <TableCell className="max-w-0 truncate text-xs">{j.preview}</TableCell>
                        <TableCell>
                          {j.label ? (
                            <VerdictBadge label={j.label} />
                          ) : (
                            <Badge variant="outline">{j.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs">
                          {relTime(j.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <GitBranch />
                    </EmptyMedia>
                    <EmptyTitle>No jobs yet</EmptyTitle>
                    <EmptyDescription>
                      Run one from the{" "}
                      <Link to="/tester" className="underline underline-offset-4">
                        API Tester
                      </Link>
                      .
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Trace"
        description={jobId}
        actions={
          <>
            {connected ? (
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <StatusDot tone="ok" />
                live
              </span>
            ) : null}
            {job?.result?.label ? <VerdictBadge label={job.result.label} /> : null}
            <Button variant="outline" size="sm" onClick={() => navigate("/trace")}>
              All jobs
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not load that job</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {job ? (
          <>
            <StageStrip events={events} job={job} />

            {job.status === "running" || job.status === "queued" ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner />
                Running — {events.length} events so far
              </div>
            ) : null}

            {job.error ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>{job.error.code}</AlertTitle>
                <AlertDescription>{job.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {job.result ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <VerdictBadge label={job.result.label} size="lg" />
                    {job.replay ? <Badge variant="outline">replay</Badge> : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm">{job.result.explanation}</p>
                  {job.result.skipped_claims.length ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium">Skipped as not checkable</span>
                      {job.result.skipped_claims.map((s, i) => (
                        <p key={i} className="text-muted-foreground text-xs">
                          <span className="font-mono">[{s.checkability}]</span> {s.text} —{" "}
                          {s.checkability_reason}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <Separator />
                  <p className="text-muted-foreground text-xs">{job.result.disclaimer}</p>
                </CardContent>
              </Card>
            ) : null}

            {job.result?.sub_claims.map((sub) => (
              <SubClaimCard key={sub.id} sub={sub} />
            ))}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CircleDot className="size-3.5" />
                  Event log
                  <Badge variant="secondary">{events.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {events.map((e) => (
                  <EventRow key={e.seq} event={e} />
                ))}
              </CardContent>
            </Card>
          </>
        ) : !error ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner />
            Loading…
          </div>
        ) : null}
      </div>
    </>
  )
}
