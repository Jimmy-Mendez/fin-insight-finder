import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SentimentResultsProps {
  results: { companies: { name: string; score: number; documents: string[]; count?: number }[] } | null;
}

export function SentimentResults({ results }: SentimentResultsProps) {
  if (!results || !results.companies?.length) {
    return <p className="text-sm text-muted-foreground">No companies detected yet.</p>;
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead className="text-right">Sentiment</TableHead>
            <TableHead className="text-right">Mentions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.companies.map((c) => (
            <TableRow key={c.name}>
              <TableCell className="font-medium truncate max-w-[280px]" title={c.name}>{c.name}</TableCell>
              <TableCell className="text-right">
                <span
                  className={[
                    "px-2 py-1 rounded text-xs font-medium",
                    c.score > 0.2 ? "bg-green-500/10 text-green-600 dark:text-green-400" :
                    c.score < -0.2 ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                    "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  ].join(" ")}
                >
                  {c.score.toFixed(3)}
                </span>
              </TableCell>
              <TableCell className="text-right">{c.count ?? c.documents.length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">Scores range from -1 (bearish) to +1 (bullish).</p>
    </div>
  );
}
