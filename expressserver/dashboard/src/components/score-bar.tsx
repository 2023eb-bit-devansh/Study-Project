import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * The four-component fusion score as a stacked bar.
 *
 *   score = 0.5·dense + 0.3·ref_hit + 0.2·exact_hit − penalties
 *
 * This is the single most useful figure for justifying hybrid retrieval:
 * it shows at a glance that an exact reference hit is what lifts the right
 * provision above a semantically similar but wrong one.
 */
const SEGMENTS = [
  { key: "dense", label: "semantic", color: "var(--stage-retrieval)" },
  { key: "ref", label: "exact reference", color: "var(--stage-verdict)" },
  { key: "exact", label: "keyword", color: "var(--stage-citation)" },
] as const

export function ScoreBar({
  components,
  score,
}: {
  components: Record<string, number> | null | undefined
  score: number
}) {
  if (!components) {
    return <span className="tabular font-mono text-xs">{score.toFixed(3)}</span>
  }
  const penalty = Math.abs((components.web ?? 0) + (components.neighbour ?? 0))

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-full items-center gap-2">
          <div className="bg-muted score-bar h-2 min-w-16 flex-1 overflow-hidden rounded-full">
            <div className="flex h-full">
              {SEGMENTS.map((s) => (
                <span
                  key={s.key}
                  style={{
                    width: `${Math.max(0, components[s.key] ?? 0) * 100}%`,
                    background: s.color,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="tabular w-10 shrink-0 text-right font-mono text-xs">
            {score.toFixed(3)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="font-mono text-xs">
        <div className="flex flex-col gap-0.5">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
              {s.label}: {(components[s.key] ?? 0).toFixed(3)}
            </span>
          ))}
          {penalty > 0 ? <span>penalties: −{penalty.toFixed(3)}</span> : null}
          <span className="border-t pt-0.5">total: {score.toFixed(3)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
