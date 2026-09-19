import { cn } from "@/lib/utils"

const VERDICT: Record<string, string> = {
  Supported: "bg-verdict-supported-bg text-verdict-supported",
  Contradicted: "bg-verdict-contradicted-bg text-verdict-contradicted",
  "Misleading Context": "bg-verdict-misleading-bg text-verdict-misleading",
  "Insufficient Evidence": "bg-verdict-insufficient-bg text-verdict-insufficient",
  "Not Checkable": "bg-verdict-notcheckable-bg text-verdict-notcheckable",
}

export function VerdictBadge({
  label,
  size = "default",
}: {
  label: string
  size?: "default" | "lg"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-medium",
        size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-xs",
        VERDICT[label] ?? "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}

const CITATION: Record<string, string> = {
  verified: "bg-verdict-supported-bg text-verdict-supported",
  partially_verified: "bg-verdict-misleading-bg text-verdict-misleading",
  rejected: "bg-verdict-contradicted-bg text-verdict-contradicted",
}

const CITATION_TEXT: Record<string, string> = {
  verified: "quote verified",
  partially_verified: "approximate match",
  rejected: "quote rejected",
}

export function CitationBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]",
        CITATION[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {CITATION_TEXT[status] ?? status}
    </span>
  )
}

const STANCE: Record<string, string> = {
  supporting: "supports the claim",
  contradicting: "contradicts the claim",
  neutral: "neither supports nor contradicts",
}

export function StanceLabel({ stance }: { stance: string }) {
  return <span className="text-muted-foreground text-[11px]">{STANCE[stance] ?? stance}</span>
}

/**
 * Highlight the run of text that citation verification actually matched.
 * This is the whole point of carrying an offset map through normalisation:
 * the user sees the real passage with the verified words marked, not a
 * cleaned-up approximation of them.
 */
export function HighlightedPassage({
  passage,
  span,
}: {
  passage: string
  span: { start: number; end: number } | null
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
