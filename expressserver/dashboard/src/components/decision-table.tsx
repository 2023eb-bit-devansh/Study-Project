import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * The deterministic verdict rule, rendered with the firing row highlighted
 * and the real numbers substituted. This one view answers "how did it
 * decide?" completely, which is why every gate emits its inputs.
 */
const RULES = [
  { id: "R0", cond: "S + C = 0", label: "Insufficient Evidence", why: "Nothing was verified" },
  { id: "R1", cond: "refOk = false", label: "Insufficient Evidence", why: "Named provision not confirmed read" },
  { id: "R2", cond: "C ≥ 1 and S < C", label: "Contradicted", why: "Verified evidence says the opposite" },
  { id: "R3", cond: "S ≥ 1, C = 0, cov ≥ 0.75, nothing unaddressed, no MC gate", label: "Supported", why: "Fully covered, nothing against" },
  { id: "R4", cond: "S ≥ 1, C = 0, MC gate open", label: "Misleading Context", why: "A verified condition is omitted" },
  { id: "R5", cond: "S ≥ 1 and C ≥ 1 and S ≥ C", label: "Misleading Context", why: "Verified evidence on both sides" },
  { id: "R6", cond: "0 < S + C < 1", label: "Insufficient Evidence", why: "Only partial quote matches" },
  { id: "R7", cond: "otherwise", label: "Insufficient Evidence", why: "Fail closed" },
]

export function DecisionTable({
  ruleId,
  inputs,
}: {
  ruleId: string
  inputs?: Record<string, unknown>
}) {
  const S = Number(inputs?.S ?? 0)
  const C = Number(inputs?.C ?? 0)
  const cov = Number(inputs?.coverage ?? 0)

  return (
    <div className="flex flex-col gap-3">
      {inputs ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
          <span>S = {S.toFixed(1)}</span>
          <span>C = {C.toFixed(1)}</span>
          <span>N = {String(inputs.N ?? 0)}</span>
          <span>coverage = {cov.toFixed(3)}</span>
          <span>refOk = {String(inputs.refOk)}</span>
          <span>MCq = {String(inputs.MCq)}</span>
          <span>qualifier = {String(inputs.qualifier)}</span>
          <span>
            unaddressed = {Array.isArray(inputs.unaddressed) ? inputs.unaddressed.length : 0}
          </span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Rule</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead className="w-44">Label</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RULES.map((r) => {
              const fired = r.id === ruleId
              return (
                <TableRow key={r.id} className={cn(fired && "bg-accent")}>
                  <TableCell className={cn("font-mono text-xs", fired && "font-semibold")}>
                    {r.id}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.cond}</TableCell>
                  <TableCell className={cn("text-xs", fired ? "font-medium" : "text-muted-foreground")}>
                    {r.label}
                    {fired ? <span className="text-muted-foreground ml-2">← fired</span> : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        Rules are evaluated top-down, first match wins. S and C count only citations that the
        verifier marked verified (weight 1.0) or partially verified (weight 0.5) — the model's own
        provisional verdict decides nothing.
      </p>
    </div>
  )
}
