import { cn } from "@/lib/utils"

type Tone = "ok" | "warn" | "down" | "idle"

const TONE: Record<Tone, string> = {
  ok: "bg-verdict-supported",
  warn: "bg-verdict-misleading",
  down: "bg-verdict-contradicted",
  idle: "bg-muted-foreground/40",
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE[tone], className)}
      aria-hidden
    />
  )
}
