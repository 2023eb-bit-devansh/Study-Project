export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n < 1) return `${n.toFixed(2)}ms`
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}s`
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (diff < 1000) return "just now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false })
}
