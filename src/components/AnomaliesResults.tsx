import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Anomaly {
  company?: string;
  metric: string;
  period?: string;
  change?: string;
  severity?: "low" | "medium" | "high";
  rationale?: string;
  document?: string;
}

export function AnomaliesResults({ anomalies }: { anomalies: Anomaly[] | null }) {
  if (!anomalies || anomalies.length === 0) {
    return <p className="text-sm text-muted-foreground">No anomalies detected yet.</p>;
  }

  const sevClass = (s?: string) =>
    s === "high"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : s === "medium"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400";

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Metric</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Severity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {anomalies.map((a, idx) => (
            <TableRow key={`${a.company}-${a.metric}-${idx}`}>
              <TableCell className="truncate max-w-[220px]" title={a.company}>{a.company || "—"}</TableCell>
              <TableCell className="truncate max-w-[220px]" title={a.rationale}>{a.metric}</TableCell>
              <TableCell>{a.change || "—"}</TableCell>
              <TableCell>{a.period || "—"}</TableCell>
              <TableCell className="text-right">
                <span className={["px-2 py-1 rounded text-xs font-medium", sevClass(a.severity)].join(" ")}>{a.severity || "low"}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">Severity reflects potential risk; review source docs to validate context.</p>
    </div>
  );
}
