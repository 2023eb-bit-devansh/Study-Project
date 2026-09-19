import { cn } from "@/lib/utils"
import type { VerdictLabel } from "@/lib/types"

/**
 * Verdict labels are the one place colour is allowed to carry meaning.
 * They are a muted background plus a text tone — never a border stripe.
 */
const STYLES: Record<string, string> = {
  Supported: "bg-verdict-supported-bg text-verdict-supported",
  Contradicted: "bg-verdict-contradicted-bg text-verdict-contradicted",
  "Misleading Context": "bg-verdict-misleading-bg text-verdict-misleading",
  "Insufficient Evidence": "bg-verdict-insufficient-bg text-verdict-insufficient",
  "Not Checkable": "bg-verdict-notcheckable-bg text-verdict-notcheckable",
}

export function VerdictBadge({
  label,
  size = "default",
  className,
}: {
  label: VerdictLabel | string | null
  size?: "default" | "lg"
  className?: string
}) {
  if (!label) return null
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium",
        size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-xs",
        STYLES[label] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  )
}

const CITATION_STYLES: Record<string, string> = {
  verified: "bg-verdict-supported-bg text-verdict-supported",
  partially_verified: "bg-verdict-misleading-bg text-verdict-misleading",
  rejected: "bg-verdict-contradicted-bg text-verdict-contradicted",
}

const CITATION_LABEL: Record<string, string> = {
  verified: "verified",
  partially_verified: "partial",
  rejected: "rejected",
}

export function CitationBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[11px]",
        CITATION_STYLES[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {CITATION_LABEL[status] ?? status}
    </span>
  )
}

const STANCE_LABEL: Record<string, string> = {
  supporting: "supports",
  contradicting: "contradicts",
  neutral: "neutral",
}

export function StanceBadge({ stance }: { stance: string }) {
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px]">
      {STANCE_LABEL[stance] ?? stance}
    </span>
  )
}
