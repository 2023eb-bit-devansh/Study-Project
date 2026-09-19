import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: "default" | "warn" | "bad"
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span
          className={cn(
            "tabular text-2xl leading-none font-medium",
            tone === "warn" && "text-verdict-misleading",
            tone === "bad" && "text-verdict-contradicted",
          )}
        >
          {value}
        </span>
        {hint ? <span className="text-muted-foreground mt-1 text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  )
}
