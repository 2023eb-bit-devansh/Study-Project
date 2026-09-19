import { Link } from "react-router-dom"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { StatusDot } from "@/components/layout/status-dot"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { StatTile } from "@/components/stat-tile"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { usePoll } from "@/hooks/use-poll"
import { get } from "@/lib/api"
import { ms, num, pct } from "@/lib/format"
import type { Health, Metrics } from "@/lib/types"

function HealthRow({ check }: { check: Health["checks"][string] }) {
  const tone = !check.ok ? "down" : check.warn ? "warn" : "ok"
  return (
    <div className="flex items-start gap-3 py-2.5">
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{check.label}</div>
        <div className="text-muted-foreground text-xs break-words">
          {check.warn && check.warnDetail ? check.warnDetail : check.detail}
        </div>
      </div>
    </div>
  )
}

export function OverviewPage() {
  const health = usePoll<Health>(
    () => get<Health>("health", { acceptStatuses: [503] }),
    10_000,
  )
  const metrics = usePoll<Metrics>(() => get<Metrics>("metrics"), 5_000)

  const h = health.data
  const m = metrics.data
  const statusTone = h?.status === "ok" ? "ok" : h?.status === "degraded" ? "warn" : "down"

  return (
    <>
      <PageHeader
        title="Overview"
        description="Dependency health and API traffic for the verification backend"
        actions={
          <>
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                health.refresh()
                metrics.refresh()
              }}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {health.error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Backend unreachable</AlertTitle>
            <AlertDescription>
              {health.error.message} — start it with <code>npm run dev</code> in{" "}
              <code>expressserver/</code>.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="System status"
            value={
              h ? (
                <span className="flex items-center gap-2">
                  <StatusDot tone={statusTone} />
                  <span className="capitalize">{h.status}</span>
                </span>
              ) : (
                <Skeleton className="h-6 w-24" />
              )
            }
            hint={h ? `v${h.version} · node ${h.node} · up ${num(h.uptimeSec)}s` : undefined}
            tone={h?.status === "down" ? "bad" : h?.status === "degraded" ? "warn" : "default"}
          />
          <StatTile
            label="Requests captured"
            value={m ? num(m.count) : <Skeleton className="h-6 w-16" />}
            hint={m ? `ring buffer holds ${num(m.ringSize)}` : undefined}
          />
          <StatTile
            label="Latency p50 / p95"
            value={m ? `${ms(m.latency.p50)} / ${ms(m.latency.p95)}` : <Skeleton className="h-6 w-28" />}
            hint={m ? `max ${ms(m.latency.max)}` : undefined}
          />
          <StatTile
            label="Error rate"
            value={m ? pct(m.errorRate) : <Skeleton className="h-6 w-16" />}
            hint={m ? `${num(m.errors)} of ${num(m.count)} responses ≥ 400` : undefined}
            tone={m && m.errorRate > 0.1 ? "bad" : m && m.errorRate > 0 ? "warn" : "default"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Dependencies</CardTitle>
            </CardHeader>
            <CardContent className="divide-y py-0">
              {h ? (
                Object.entries(h.checks).map(([key, check]) => <HealthRow key={key} check={check} />)
              ) : (
                <div className="flex flex-col gap-3 py-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Traffic by endpoint</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {m && m.byPath.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead className="w-16 text-right">Calls</TableHead>
                      <TableHead className="w-20 text-right">Avg</TableHead>
                      <TableHead className="w-20 text-right">Max</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.byPath.slice(0, 10).map((p) => (
                      <TableRow key={p.key}>
                        <TableCell className="font-mono text-xs">
                          {p.key}
                          {p.errors > 0 ? (
                            <Badge variant="destructive" className="ml-2">
                              {p.errors} err
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs">{num(p.count)}</TableCell>
                        <TableCell className="tabular text-right text-xs">{ms(p.avgMs)}</TableCell>
                        <TableCell className="tabular text-right text-xs">{ms(p.maxMs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground px-6 py-8 text-center text-sm">
                  No traffic yet. Fire a request from the{" "}
                  <Link to="/tester" className="underline underline-offset-4">
                    API Tester
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
