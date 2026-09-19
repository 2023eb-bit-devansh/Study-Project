import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle, ArrowLeft, Ban, Image as ImageIcon, ScanText, Scale, Send, Settings,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import { ProgressStrip } from "@/components/progress-strip"
import {
  CitationBadge, HighlightedPassage, StanceLabel, VerdictBadge,
} from "@/components/verdict"
import {
  cancelJob, confirmJob, createImageJob, createTextJob, fetchHealth, type EvidenceItem,
  type SubClaim,
} from "@/lib/api"
import { useJob } from "@/lib/useJob"
import { PENDING_KEY, type PendingInput } from "@/lib/config"

type Screen = "input" | "confirm" | "running" | "result"

export function SidePanel() {
  const [screen, setScreen] = useState<Screen>("input")
  const [text, setText] = useState("")
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [corrected, setCorrected] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null)
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { job, events, error, reset } = useJob(jobId)

  // ── backend reachability, checked once on open ──────────────────────
  useEffect(() => {
    fetchHealth()
      .then((h) => {
        const bad = Object.values(h.checks).filter((c) => !c.ok)
        setHealth(
          bad.length
            ? { ok: false, detail: bad.map((c) => `${c.label}: ${c.detail}`).join(" · ") }
            : { ok: true, detail: "" },
        )
      })
      .catch((err) => setHealth({ ok: false, detail: (err as Error).message }))
  }, [])

  // ── anything the service worker parked for us ───────────────────────
  useEffect(() => {
    const consume = async () => {
      const stored = await chrome.storage.session.get(PENDING_KEY)
      const pending = stored[PENDING_KEY] as (PendingInput & { at: number }) | undefined
      if (!pending) return
      await chrome.storage.session.remove(PENDING_KEY)

      setSourceUrl(pending.sourceUrl)
      if (pending.kind === "text") {
        setText(pending.text)
        void start(() => createTextJob(pending.text, pending.sourceUrl))
      } else if (pending.kind === "image") {
        void start(() => createImageJob(pending.base64, pending.mimeType, pending.sourceUrl))
      } else {
        setBanner({
          title: "That image could not be read",
          body:
            "Access to the image's site was declined or the fetch failed. You can still upload the "
            + "image file directly, or paste the claim as text.",
        })
      }
    }
    void consume()
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[PENDING_KEY]?.newValue) void consume()
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(
    async (create: () => Promise<{ job_id: string }>) => {
      setSubmitting(true)
      setBanner(null)
      reset()
      try {
        const { job_id } = await create()
        setJobId(job_id)
        setScreen("running")
      } catch (err) {
        setBanner({ title: "Could not start the check", body: (err as Error).message })
      } finally {
        setSubmitting(false)
      }
    },
    [reset],
  )

  // ── screen transitions driven by job status ─────────────────────────
  useEffect(() => {
    if (!job) return
    if (job.status === "awaiting_confirmation" && job.transcription) {
      setCorrected(job.transcription.transcribed_text)
      setScreen("confirm")
    } else if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
      setScreen("result")
    }
  }, [job])

  async function onFile(file: File) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ""
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    }
    void start(() => createImageJob(btoa(binary), file.type || "image/png", sourceUrl))
  }

  function goHome() {
    setJobId(null)
    setScreen("input")
    setBanner(null)
    reset()
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="bg-background/95 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2 backdrop-blur">
        <div className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded">
          <Scale className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">AI Fact Checker</h1>
          <p className="text-muted-foreground truncate text-[11px]">Indian law · evidence-first</p>
        </div>
        {screen !== "input" ? (
          <Button variant="ghost" size="sm" onClick={goHome}>
            <ArrowLeft data-icon="inline-start" />
            New
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Options"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            <Settings />
          </Button>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {health && !health.ok ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Backend not ready</AlertTitle>
            <AlertDescription className="text-xs">{health.detail}</AlertDescription>
          </Alert>
        ) : null}

        {banner ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>{banner.title}</AlertTitle>
            <AlertDescription className="text-xs">{banner.body}</AlertDescription>
          </Alert>
        ) : null}

        {screen === "input" ? (
          <InputScreen
            text={text}
            setText={setText}
            submitting={submitting}
            onSubmit={() => start(() => createTextJob(text.trim(), sourceUrl))}
            onPickFile={() => fileRef.current?.click()}
          />
        ) : null}

        {screen === "confirm" && job?.transcription ? (
          <ConfirmScreen
            transcription={job.transcription}
            value={corrected}
            setValue={setCorrected}
            onConfirm={async () => {
              setSubmitting(true)
              try {
                await confirmJob(job.id, corrected)
                setScreen("running")
              } catch (err) {
                setBanner({ title: "Could not continue", body: (err as Error).message })
              } finally {
                setSubmitting(false)
              }
            }}
            submitting={submitting}
          />
        ) : null}

        {screen === "running" ? (
          <RunningScreen
            events={events}
            error={error}
            onCancel={async () => {
              if (jobId) await cancelJob(jobId).catch(() => {})
            }}
          />
        ) : null}

        {screen === "result" && job ? <ResultScreen job={job} /> : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ""
          }}
        />
      </main>
    </div>
  )
}

function InputScreen({
  text, setText, submitting, onSubmit, onPickFile,
}: {
  text: string
  setText: (v: string) => void
  submitting: boolean
  onSubmit: () => void
  onPickFile: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        rows={6}
        placeholder="Paste a legal claim, or right-click selected text on any page and choose Fact-check."
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onSubmit} disabled={!text.trim() || submitting}>
          {submitting ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
          Check this claim
        </Button>
        <Button variant="outline" onClick={onPickFile} aria-label="Upload an image">
          <ImageIcon />
        </Button>
      </div>

      <Separator />

      <div className="text-muted-foreground flex flex-col gap-2 text-xs">
        <p className="font-medium">How to use it</p>
        <p>
          Select text on any page, right-click, and choose <em>Fact-check</em>. Or right-click an
          image containing a claim. Results appear here.
        </p>
        <p>
          Every verdict is decided from passages retrieved out of a curated corpus of Indian
          statutes and judgments — and every quotation is matched back to its source before it is
          allowed to count.
        </p>
      </div>
    </div>
  )
}

function ConfirmScreen({
  transcription, value, setValue, onConfirm, submitting,
}: {
  transcription: { transcribed_text: string; legibility: string; illegible_spans: string[]; layout_note: string }
  value: string
  setValue: (v: string) => void
  onConfirm: () => void
  submitting: boolean
}) {
  const unreadable = value.includes("[illegible]")
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <ScanText />
        <AlertTitle>Check the text before it is verified</AlertTitle>
        <AlertDescription className="text-xs">
          This is what was read from the image
          {transcription.layout_note ? ` (${transcription.layout_note})` : ""}. Correct anything
          wrong — the verification runs on exactly this text.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          legibility: {transcription.legibility}
        </Badge>
        {unreadable ? (
          <Badge variant="outline" className="text-verdict-misleading text-[11px]">
            contains unreadable parts
          </Badge>
        ) : null}
      </div>

      <Textarea rows={8} value={value} onChange={(e) => setValue(e.target.value)} className="text-sm" />

      <Button onClick={onConfirm} disabled={!value.trim() || submitting}>
        {submitting ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
        Verify this text
      </Button>
    </div>
  )
}

function RunningScreen({
  events, error, onCancel,
}: {
  events: { seq: number; stage: string; label: string }[]
  error: string | null
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <ProgressStrip events={events as never} done={false} />

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Lost contact with the backend</AlertTitle>
          <AlertDescription className="text-xs">{error} — still retrying.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex max-h-64 flex-col gap-1 overflow-y-auto px-3 py-2">
          {events.slice(-14).map((e) => (
            <p key={e.seq} className="text-muted-foreground text-[11px] leading-snug">
              {e.label}
            </p>
          ))}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        This takes 30–90 seconds: the system searches the corpus, reads passages, looks for
        exceptions, then checks every quotation against its source.
      </p>

      <Button variant="outline" size="sm" onClick={onCancel}>
        <Ban data-icon="inline-start" />
        Cancel
      </Button>
    </div>
  )
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <div className="rounded-md border p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <CitationBadge status={item.citation.status} />
        <StanceLabel stance={item.stance} />
      </div>
      <p className="mb-1.5 text-xs font-medium">
        {item.source_url ? (
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {item.source_label}
          </a>
        ) : (
          item.source_label
        )}
      </p>
      {item.status_meta && item.status_meta !== "in_force" ? (
        <Badge variant="outline" className="mb-1.5 text-[11px]">
          {item.status_meta.replace(/_/g, " ")}
        </Badge>
      ) : null}
      <p className="text-muted-foreground text-[11px] leading-relaxed whitespace-pre-line">
        <HighlightedPassage passage={item.passage} span={item.citation.span} />
      </p>
      {item.citation.status !== "verified" && item.citation.reason ? (
        <p className="text-verdict-misleading mt-1.5 text-[11px]">{item.citation.reason}</p>
      ) : null}
    </div>
  )
}

function SubClaimBlock({ sub }: { sub: SubClaim }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <VerdictBadge label={sub.label} />
        {sub.ref_keys.map((k) => (
          <Badge key={k} variant="secondary" className="text-[11px]">
            {k}
          </Badge>
        ))}
        {sub.retrieval.web_used ? (
          <Badge variant="outline" className="text-[11px]">
            live search
          </Badge>
        ) : null}
      </div>
      <p className="text-xs">{sub.text}</p>
      <p className="text-muted-foreground text-xs">{sub.explanation}</p>
      {sub.evidence.length > 0 ? (
        <Accordion type="single" collapsible>
          <AccordionItem value="evidence">
            <AccordionTrigger className="py-2 text-xs">
              Evidence ({sub.evidence.length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-2">
              {sub.evidence.map((e) => (
                <EvidenceCard key={e.evidence_id} item={e} />
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </div>
  )
}

function ResultScreen({ job }: { job: NonNullable<ReturnType<typeof useJob>["job"]> }) {
  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <Alert variant={job.status === "failed" ? "destructive" : "default"}>
        <AlertTriangle />
        <AlertTitle>{job.status === "failed" ? "The check failed" : "Cancelled"}</AlertTitle>
        <AlertDescription className="text-xs">
          {job.error?.message ?? "The verification was stopped before it finished."}
        </AlertDescription>
      </Alert>
    )
  }

  const result = job.result
  if (!result) return null

  return (
    <div className="flex flex-col gap-3">
      <VerdictBadge label={result.label} size="lg" />
      <p className="text-sm leading-relaxed">{result.explanation}</p>

      {result.skipped_claims.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border p-2.5">
          <p className="text-xs font-medium">Not checked</p>
          {result.skipped_claims.map((s, i) => (
            <p key={i} className="text-muted-foreground text-[11px]">
              “{s.text}” — {s.checkability_reason}
            </p>
          ))}
        </div>
      ) : null}

      {result.sub_claims.map((sub, i) => (
        <div key={sub.id} className="flex flex-col gap-3">
          {i > 0 ? <Separator /> : null}
          <SubClaimBlock sub={sub} />
        </div>
      ))}

      <Separator />
      <p className="text-muted-foreground text-[11px] leading-relaxed">{result.disclaimer}</p>
    </div>
  )
}
