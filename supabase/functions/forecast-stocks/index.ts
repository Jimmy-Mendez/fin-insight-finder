import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");

interface ForecastRequestBody {
  tickers?: string[];
  horizonDays?: number; // default 30
}

interface SeriesPoint { date: string; close: number }
interface ForecastPoint { date: string; predicted: number }

function parseDailySeries(json: any): SeriesPoint[] {
  const res = json?.chart?.result?.[0];
  if (!res) return [];
  const ts: number[] | undefined = res.timestamp;
  const adj: (number | null)[] | undefined = res.indicators?.adjclose?.[0]?.adjclose;
  const close: (number | null)[] | undefined = res.indicators?.quote?.[0]?.close;
  if (!ts || ts.length === 0) return [];
  const out: SeriesPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = (adj && adj[i] != null ? adj[i] : close?.[i]);
    if (c == null || !Number.isFinite(c)) continue;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    out.push({ date, close: Number(c) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function linearRegression(y: number[]) {
  const n = y.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
  const denom = n * sumXX - sumX * sumX;
  const m = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const b = n !== 0 ? (sumY - m * sumX) / n : 0;
  return { m, b };
}

function stdDev(arr: number[]) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function nextBusinessDays(start: Date, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(start.getTime());
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip Sun/Sat
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchSeries(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&includeAdjustedClose=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status}`);
  const json = await res.json();
  if (json?.chart?.error) {
    throw new Error(json.chart.error?.description || "Yahoo Finance error");
  }
  const parsed = parseDailySeries(json);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`No time series data for ${symbol}`);
  }
  return parsed;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tickers = ["WMT", "MCD", "ADBE"], horizonDays = 30 } = (await req.json().catch(() => ({}))) as ForecastRequestBody;

    const unique = Array.from(new Set(tickers.map(t => String(t).trim().toUpperCase()).filter(Boolean)));

    const results = [] as Array<{
      symbol: string;
      history: SeriesPoint[];
      forecast: ForecastPoint[];
      metrics: { lastClose: number; trend: "up" | "down" | "flat"; expectedChangePct: number; volatility: number };
    }>;

for (const symbol of unique) {
  try {
    const series = await fetchSeries(symbol);
    if (!series.length) throw new Error("Empty series");
    const closes = series.map((s) => s.close);
    const lastClose = closes[closes.length - 1];
    if (!Number.isFinite(lastClose)) throw new Error("Invalid last close");
    const returns = [] as number[];
    for (let i = 1; i < closes.length; i++) {
      const r = (closes[i] - closes[i - 1]) / closes[i - 1];
      if (Number.isFinite(r)) returns.push(r);
    }
    const vol = stdDev(returns);
    const { m, b } = linearRegression(closes);
    const trend: "up" | "down" | "flat" = m > 0 ? "up" : m < 0 ? "down" : "flat";
    const lastIndex = closes.length - 1;
    const lastDateStr = series[series.length - 1]?.date;
    const baseDate = lastDateStr ? new Date(`${lastDateStr}T00:00:00`) : new Date();
    const futureDates = nextBusinessDays(baseDate, horizonDays);
    const forecast: ForecastPoint[] = futureDates.map((date, i) => {
      const x = lastIndex + (i + 1);
      const predicted = m * x + b;
      return { date, predicted: Number(predicted.toFixed(2)) };
    });
    const expectedChangePct = forecast.length && lastClose
      ? (forecast[forecast.length - 1].predicted - lastClose) / lastClose
      : 0;

    results.push({
      symbol,
      history: series,
      forecast,
      metrics: {
        lastClose: Number(lastClose.toFixed(2)),
        trend,
        expectedChangePct: Number((expectedChangePct * 100).toFixed(2)),
        volatility: Number((vol * 100).toFixed(2)),
      },
    });
  } catch (err) {
    console.error(`Failed ticker ${symbol}:`, err);
    results.push({
      symbol,
      history: [],
      forecast: [],
      metrics: { lastClose: 0, trend: "flat", expectedChangePct: 0, volatility: 0 },
    });
  }
}

    return new Response(
      JSON.stringify({ tickers: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("forecast-stocks error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
