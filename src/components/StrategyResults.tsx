import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Decision = "Buy" | "Sell" | "Hold";

export interface StrategyItem {
  symbol: string;
  decision: Decision;
  confidence: number; // 0-100
  metrics: { expectedChangePct: number; volatility: number; sentiment?: number; trend: "up" | "down" | "flat" };
  reasons: string[];
  sources: string[];
}

export function StrategyResults({ results }: { results: StrategyItem[] | null }) {
  if (!results || results.length === 0) {
    return <p className="text-sm text-muted-foreground">No strategy yet. Click Analyze Strategy to generate recommendations.</p>;
  }

  const chip = (label: string, tone: "pos" | "neg" | "neu") => (
    <span
      className={[
        "px-2 py-0.5 rounded text-xs font-medium",
        tone === "pos"
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : tone === "neg"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      ].join(" ")}
    >
      {label}
    </span>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Decision</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead className="text-right">30d Δ%</TableHead>
                <TableHead className="text-right">Volatility %</TableHead>
                <TableHead className="text-right">Sentiment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="font-medium">{r.symbol}</TableCell>
                  <TableCell className="text-right">
                    {chip(r.decision, r.decision === "Buy" ? "pos" : r.decision === "Sell" ? "neg" : "neu")}
                  </TableCell>
                  <TableCell className="text-right">{Math.round(r.confidence)}%</TableCell>
                  <TableCell className="text-right">{r.metrics.expectedChangePct.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{r.metrics.volatility.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">
                    {r.metrics.sentiment == null ? "—" : r.metrics.sentiment.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {results.map((r) => (
        <Card key={`${r.symbol}-explain`}>
          <CardHeader>
            <CardTitle>{r.symbol} strategy debrief</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              {r.reasons.map((reason, idx) => (
                <li key={idx} className="text-sm text-muted-foreground">{reason}</li>
              ))}
            </ul>
            <div className="pt-2">
              <p className="text-xs text-muted-foreground">Sources:</p>
              <ul className="text-xs text-muted-foreground list-disc pl-5">
                {r.sources.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
