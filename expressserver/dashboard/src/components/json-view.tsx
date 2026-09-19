import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function JsonView({
  value,
  className,
  maxHeight = "24rem",
}: {
  value: unknown
  className?: string
  maxHeight?: string
}) {
  const [copied, setCopied] = useState(false)
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5 z-10"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        aria-label="Copy JSON"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <pre
        className="bg-muted/40 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  )
}
