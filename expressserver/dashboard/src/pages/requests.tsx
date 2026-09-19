import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { RefreshCw, Search } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { JsonView } from "@/components/json-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { usePoll } from "@/hooks/use-poll"
import { get } from "@/lib/api"
import { bytes, clockTime, ms } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { RequestEntry } from "@/lib/types"

function statusTone(status: number) {
  if (status >= 500) return "text-verdict-contradicted"
  if (status >= 400) return "text-verdict-misleading"
  return "text-muted-foreground"
}

export function RequestsPage() {
  const [live, setLive] = useState(true)
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selected, setSelected] = useState<RequestEntry | null>(null)

  const { data, loading, refresh } = usePoll<{ total: number; items: RequestEntry[] }>(
    () => get(`requests?limit=300`),
    live ? 2000 : 0,
  )

  const items = useMemo(() => {
    const all = data?.items ?? []
    const q = filter.trim().toLowerCase()
    return all.filter((e) => {
      if (statusFilter !== "all" && String(e.status)[0] !== statusFilter) return false
      if (!q) return true
      return e.path.toLowerCase().includes(q) || e.method.toLowerCase().includes(q) || e.id.includes(q)
    })
  }, [data, filter, statusFilter])

  return (
    <>
      <PageHeader
        title="Requests"
        description="Every API call the backend has served, from an in-process ring buffer"
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch id="live" checked={live} onCheckedChange={setLive} />
              <Label htmlFor="live" className="text-xs">
                Live
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Filter by path, method or request id…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={statusFilter}
            onValueChange={(v) => v && setStatusFilter(v)}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="2">2xx</ToggleGroupItem>
            <ToggleGroupItem value="4">4xx</ToggleGroupItem>
            <ToggleGroupItem value="5">5xx</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-muted-foreground text-xs">
            {items.length} of {data?.total ?? 0}
          </span>
        </div>

        <div className="overflow-hidden rounded-md border">
          {loading && !data ? (
            <div className="flex flex-col gap-2 p-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No requests captured</EmptyTitle>
                <EmptyDescription>
                  Fire one from the <Link to="/tester" className="underline underline-offset-4">API Tester</Link>.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="max-h-[calc(100vh-13rem)] overflow-auto">
              <Table>
                <TableHeader className="bg-background sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-20">Time</TableHead>
                    <TableHead className="w-16">Method</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead className="w-16 text-right">Status</TableHead>
                    <TableHead className="w-20 text-right">Duration</TableHead>
                    <TableHead className="w-20 text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(e)}
                    >
                      <TableCell className="tabular text-muted-foreground text-xs">
                        {clockTime(e.ts)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {e.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-0 truncate font-mono text-xs">
                        {e.path}
                        {e.jobId ? (
                          <span className="text-muted-foreground ml-2">{e.jobId}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn("tabular text-right font-mono text-xs", statusTone(e.status))}>
                        {e.status}
                      </TableCell>
                      <TableCell className="tabular text-right text-xs">{ms(e.durationMs)}</TableCell>
                      <TableCell className="tabular text-muted-foreground text-right text-xs">
                        {e.responseBytes ? bytes(e.responseBytes) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">
              {selected?.method} {selected?.path}
            </SheetTitle>
            <SheetDescription>
              {selected ? (
                <span className="tabular">
                  {selected.status} · {ms(selected.durationMs)} · {clockTime(selected.ts)} ·{" "}
                  {selected.id}
                </span>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          {selected ? (
            <div className="flex flex-col gap-4 px-4 pb-6">
              {selected.jobId ? (
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link to={`/trace/${selected.jobId}`}>Open pipeline trace</Link>
                </Button>
              ) : null}

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium">Request headers</h3>
                <JsonView value={selected.requestHeaders} maxHeight="12rem" />
              </section>

              {selected.query ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">Query</h3>
                  <JsonView value={selected.query} maxHeight="8rem" />
                </section>
              ) : null}

              {selected.requestBody ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">Request body</h3>
                  <JsonView
                    value={
                      selected.requestBody.kind === "json"
                        ? selected.requestBody.json
                        : selected.requestBody
                    }
                  />
                </section>
              ) : null}

              {selected.responseBody ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">Response body</h3>
                  <JsonView
                    value={
                      selected.responseBody.kind === "json"
                        ? selected.responseBody.json
                        : selected.responseBody
                    }
                  />
                </section>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
