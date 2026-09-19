import { Check, FileText, GitBranch, Quote, Scale, Search, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Stage, TraceSummary } from "@/lib/api"

const STAGES: { key: Stage; label: string; icon: typeof Search }[] = [
  { key: "input", label: "Read", icon: FileText },
  { key: "claim_extraction", label: "Claims", icon: Scale },
  { key: "retrieval", label: "Evidence", icon: Search },
  { key: "verdict", label: "Compare", icon: GitBranch },
  { key: "citation", label: "Verify", icon: Quote },
  { key: "assembly", label: "Result", icon: ShieldCheck },
]

/**
 * Six dots and one status line, driven entirely by the trace `label` field.
 * The panel never parses `detail` — it only receives the summary projection.
 */
export function ProgressStrip({
  events,
  done,
}: {
  events: TraceSummary[]
  done: boolean
}) {
  const reached = new Set(events.map((e) => e.stage))
  const current = events.length ? events[events.length - 1] : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {STAGES.map((s, i) => {
          const active = reached.has(s.key)
          const isCurrent = !done && current?.stage === s.key
          return (
            <div key={s.key} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active ? "border-foreground/30 bg-muted" : "border-dashed opacity-40",
                  isCurrent && "border-foreground",
                )}
                title={s.label}
              >
                {done && active ? (
                  <Check className="size-3" />
                ) : (
                  <s.icon className={cn("size-3", isCurrent && "animate-pulse")} />
                )}
              </div>
              {i < STAGES.length - 1 ? (
                <span
                  className={cn("h-px flex-1", active ? "bg-border" : "bg-border/40")}
                  aria-hidden
                />
              ) : null}
            </div>
          )
        })}
      </div>
      {current ? (
        <p className="text-muted-foreground line-clamp-2 text-xs">{current.label}</p>
      ) : null}
    </div>
  )
}
