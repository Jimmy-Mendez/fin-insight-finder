import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface HistoryPoint { date: string; close: number }
interface ForecastPoint { date: string; predicted: number }

interface TickerForecast {
  symbol: string;
  history: HistoryPoint[];
  forecast: ForecastPoint[];
  metrics: { lastClose: number; trend: "up" | "down" | "flat"; expectedChangePct: number; volatility: number };
}

export function ForecastResults({ data }: { data: { tickers: TickerForecast[] } | null }) {
  if (!data || !data.tickers?.length) {
    return <p className="text-sm text-muted-foreground">No forecast yet. Enter tickers and run forecasting.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Last Close</TableHead>
                <TableHead className="text-right">Trend</TableHead>
                <TableHead className="text-right">30d Forecast Δ%</TableHead>
                <TableHead className="text-right">Volatility (σ, %)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tickers.map((t) => (
                <TableRow key={t.symbol}>
                  <TableCell className="font-medium">{t.symbol}</TableCell>
                  <TableCell className="text-right">${t.metrics.lastClose.toFixed(2)}</TableCell>
                  <TableCell className="text-right capitalize">{t.metrics.trend}</TableCell>
                  <TableCell className="text-right">
                    <span className={[
                      "px-2 py-1 rounded text-xs font-medium",
                      t.metrics.expectedChangePct > 0 ? "bg-green-500/10 text-green-600 dark:text-green-400" :
                      t.metrics.expectedChangePct < 0 ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                      "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    ].join(" ")}
                    >
                      {t.metrics.expectedChangePct.toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{t.metrics.volatility.toFixed(2)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-2">Forecast is a simple linear trend projection over the last available prices; for research use only.</p>
        </CardContent>
      </Card>

      {data.tickers.map((t) => {
        const lastDate = t.history[t.history.length - 1]?.date;
        const combined = [
          ...t.history.map(h => ({ date: h.date, close: h.close, predicted: null as any })),
          ...t.forecast.map(f => ({ date: f.date, close: null as any, predicted: f.predicted })),
        ];
        return (
          <Card key={t.symbol}>
            <CardHeader>
              <CardTitle>{t.symbol} forecast</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combined} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip formatter={(v: any) => (typeof v === 'number' ? v.toFixed(2) : v)} />
                    <Legend />
                    <Line type="monotone" name="Close" dataKey="close" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" name="Forecast" dataKey="predicted" stroke="hsl(var(--accent))" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Last actual: {lastDate || "—"}. Forecast shows next 30 trading days.</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
