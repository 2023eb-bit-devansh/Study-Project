import { useState } from "react"
import { Check, Info, Search } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePoll } from "@/hooks/use-poll"
import { get } from "@/lib/api"
import type { ConfigResponse } from "@/lib/types"

const ROLE_LABEL: Record<string, string> = {
  extraction: "Claim extraction",
  vision: "Image transcription",
  retrieval: "Query refinement",
  verdict: "Verdict",
  grounding: "Live search grounding",
  embed: "Embeddings",
}

function renderValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "true" : "false"
  if (v === "" || v === null || v === undefined) return "—"
  return String(v)
}

export function ConfigPage() {
  const { data, loading } = usePoll<ConfigResponse>(() => get<ConfigResponse>("config"), 0)
  const [query, setQuery] = useState("")

  const models = data?.resolvedModels
  const q = query.trim().toLowerCase()

  return (
    <>
      <PageHeader
        title="Config"
        description="Every model id and threshold, resolved at boot. Secrets redacted."
      />

      <div className="flex flex-col gap-4 p-4">
        <Alert>
          <Info />
          <AlertTitle>Nothing here is hardcoded</AlertTitle>
          <AlertDescription>
            Every value below comes from <code>expressserver/.env</code> via the frozen config
            object in <code>src/config/index.js</code> — the only module in the codebase permitted
            to read <code>process.env</code>. Model ids are resolved against Gemini ListModels at
            boot rather than at request time.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resolved Gemini models</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {models ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Model id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(ROLE_LABEL).map(([role, label]) => (
                      <TableRow key={role}>
                        <TableCell className="text-sm">{label}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {models[role as keyof typeof models] ? (
                            String(models[role as keyof typeof models])
                          ) : (
                            <span className="text-muted-foreground">unresolved</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
                  <Badge variant="secondary">source: {models.source}</Badge>
                  {models.available?.length ? (
                    <Badge variant="outline">{models.available.length} models visible to this key</Badge>
                  ) : null}
                </div>
                {models.warnings?.length ? (
                  <div className="px-6 pt-3">
                    {models.warnings.map((w) => (
                      <Alert key={w} variant="destructive" className="mb-2">
                        <Info />
                        <AlertDescription>{w}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-2 px-6">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="relative max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            placeholder="Filter settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && !data ? <Skeleton className="h-64 w-full" /> : null}

        {data?.groupOrder.map((group) => {
          const entries = Object.entries(data.groups[group] ?? {}).filter(
            ([key]) => !q || key.toLowerCase().includes(q) || group.includes(q),
          )
          if (entries.length === 0) return null
          return (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="text-sm capitalize">{group}</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[46%]">Key</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-24 text-right">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map(([key, entry]) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-xs">{key}</TableCell>
                        <TableCell className="tabular font-mono text-xs break-all">
                          {renderValue(entry.value)}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.isDefault ? (
                            <span className="text-muted-foreground text-xs">default</span>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Check className="size-3" />
                              .env
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
