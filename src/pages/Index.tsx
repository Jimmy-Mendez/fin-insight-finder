import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { GradientOrb } from "@/components/GradientOrb";
import { supabase } from "@/integrations/supabase/client";
import { extractPdfText } from "@/lib/pdf";
import { chunkText } from "@/lib/chunk";
import { SentimentResults } from "@/components/SentimentResults";
import { AnomaliesResults } from "@/components/AnomaliesResults";
import { ForecastResults } from "@/components/ForecastResults";
import { StrategyResults } from "@/components/StrategyResults";
interface LocalDoc {
  name: string;
  size: number;
  progress: number;
  status?: string;
}

const Index = () => {
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [question, setQuestion] = useState("");
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentResults, setSentimentResults] = useState<{ companies: { name: string; score: number; documents: string[]; count?: number }[] } | null>(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [anomaliesResults, setAnomaliesResults] = useState<any[] | null>(null);
  const [tickersInput, setTickersInput] = useState("WMT,MCD,ADBE");
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastResults, setForecastResults] = useState<any | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [strategyResults, setStrategyResults] = useState<any[] | null>(null);
  const totalSize = useMemo(() => docs.reduce((a, d) => a + d.size, 0), [docs]);

  const updateDoc = (name: string, update: Partial<LocalDoc>) => {
    setDocs(prev => prev.map(d => (d.name === name ? { ...d, ...update } : d)));
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).filter(f => f.type === "application/pdf");
    if (accepted.length === 0) {
      toast({ title: "Only PDFs allowed", variant: "destructive" });
      return;
    }
    setDocs(prev => [
      ...prev,
      ...accepted.map(f => ({ name: f.name, size: f.size, progress: 0, status: "Queued" }))
    ]);
    toast({ title: "Documents added", description: `${accepted.length} PDF(s) queued` });
    void processUploads(accepted);
  };

  const processUploads = async (files: File[]) => {
    let success = 0;
    for (const file of files) {
      try {
        toast({ title: `Extracting ${file.name}...` });
        updateDoc(file.name, { status: "Extracting...", progress: 5 });
        const { text, pages } = await extractPdfText(file);
        if (!text) {
          toast({ title: "No text found", description: file.name, variant: "destructive" });
          updateDoc(file.name, { status: "No text found" });
          continue;
        }

        const { data: doc, error: docErr } = await supabase
          .from("documents")
          .insert({ title: file.name, source: "upload", metadata: { size: file.size, pages } })
          .select()
          .single();

        if (docErr || !doc) {
          console.error("Insert document error:", docErr);
          toast({ title: "Failed to save document", description: file.name, variant: "destructive" });
          continue;
        }

        setCurrentDocId(doc.id);

        const chunks = chunkText(text, 1500, 200);
        toast({ title: `Indexing ${file.name}`, description: `${chunks.length} chunks` });
        updateDoc(file.name, { status: `Indexing ${chunks.length} chunks...`, progress: 20 });

        const batchSize = 24;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const slice = chunks.slice(i, i + batchSize);
          const { data: embedData, error: embedErr } = await supabase.functions.invoke("embed-text", {
            body: { texts: slice.map((t) => `passage: ${t}`) },
          });
          if (embedErr || !embedData?.embeddings) {
            console.error("embed-text error:", embedErr || embedData);
            toast({ title: "Embedding failed", description: file.name, variant: "destructive" });
            updateDoc(file.name, { status: "Embedding failed" });
            break;
          }
          const embeddings: number[][] = embedData.embeddings as number[][];
          const rows = embeddings.map((emb, idx) => ({
            document_id: doc.id,
            chunk_index: i + idx,
            content: slice[idx],
            embedding: emb,
          }));
          const { error: insErr } = await supabase.from("document_chunks").insert(rows as any);
          if (insErr) {
            console.error("Insert chunks error:", insErr);
            toast({ title: "Chunk insert failed", description: file.name, variant: "destructive" });
            updateDoc(file.name, { status: "Error during chunk insert" });
            break;
          }
          const completed = Math.min(i + slice.length, chunks.length);
          const progress = Math.min(95, Math.round(20 + (completed / chunks.length) * 75));
          updateDoc(file.name, { status: `Embedding ${completed}/${chunks.length}`, progress });
        }

        toast({ title: "Document indexed", description: file.name });
        updateDoc(file.name, { status: "Indexed", progress: 100 });
        success++;
      } catch (e) {
        console.error("Process upload error:", e);
        toast({ title: "Processing failed", description: file.name, variant: "destructive" });
        updateDoc(file.name, { status: "Processing failed" });
      }
    }
    toast({ title: "Indexing complete", description: `${success} of ${files.length} document(s) indexed. Ready for Q&A.` });
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    toast({ title: "Asking OpenAI...", description: "Generating answer" });
    try {
      const { data, error } = await supabase.functions.invoke("generate-answer", {
        body: { question: q, document_id: currentDocId ?? undefined, top_k: 12 },
      });
      if (error) throw error;
      const answer: string = data?.answer ?? "No answer returned.";
      toast({ title: "Answer", description: answer });
    } catch (err: any) {
      console.error("Q&A error", err);
      toast({ title: "Error", description: err?.message || "Failed to get answer", variant: "destructive" });
    }
  };

  const handleSentiment = async () => {
    try {
      setSentimentLoading(true);
      setSentimentResults(null);
      toast({ title: "Running sentiment", description: "Analyzing mentioned companies across all documents..." });
      const { data, error } = await supabase.functions.invoke("analyze-sentiment", { body: {} });
      if (error) throw error;
      setSentimentResults(data as any);
      toast({ title: "Sentiment complete", description: "Results are ready." });
    } catch (err: any) {
      console.error("Sentiment error", err);
      toast({ title: "Error", description: err?.message || "Failed to run sentiment", variant: "destructive" });
    } finally {
      setSentimentLoading(false);
    }
  };

  const handleAnomalies = async () => {
    try {
      setAnomaliesLoading(true);
      setAnomaliesResults(null);
      toast({ title: "Scanning anomalies", description: "Reviewing all documents for financial red flags..." });
      const { data, error } = await supabase.functions.invoke("analyze-anomalies", { body: {} });
      if (error) throw error;
      setAnomaliesResults((data as any)?.anomalies ?? []);
      toast({ title: "Anomaly scan complete", description: "Results are ready." });
    } catch (err: any) {
      console.error("Anomalies error", err);
      toast({ title: "Error", description: err?.message || "Failed to scan anomalies", variant: "destructive" });
    } finally {
      setAnomaliesLoading(false);
    }
  };

  const handleForecast = async () => {
    try {
      setForecastLoading(true);
      setForecastResults(null);
      const tickers = tickersInput
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      if (tickers.length === 0) {
        toast({ title: "No tickers", description: "Please enter at least one ticker.", variant: "destructive" });
        return;
      }
      toast({ title: "Fetching market data", description: `Running 30d forecast for ${tickers.join(", ")}` });
      const { data, error } = await supabase.functions.invoke("forecast-stocks", { body: { tickers } });
      if (error) throw error;
      setForecastResults(data as any);
      toast({ title: "Forecast complete", description: "Charts and metrics are ready." });
    } catch (err: any) {
      console.error("Forecast error", err);
      toast({ title: "Error", description: err?.message || "Failed to run forecast", variant: "destructive" });
    } finally {
      setForecastLoading(false);
    }
  };

  const handleAnalyze = async () => {
    try {
      setAnalyzeLoading(true);
      setStrategyResults(null);
      const tickers = tickersInput
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      if (tickers.length === 0) {
        toast({ title: "No tickers", description: "Please enter at least one ticker.", variant: "destructive" });
        return;
      }
      toast({ title: "Analyzing", description: "Running forecasts, sentiment, and anomaly checks..." });

      const [forecastResp, sentimentResp, anomaliesResp, docsResp] = await Promise.all([
        supabase.functions.invoke("forecast-stocks", { body: { tickers } }),
        supabase.functions.invoke("analyze-sentiment", { body: {} }),
        supabase.functions.invoke("analyze-anomalies", { body: {} }),
        supabase.from("documents").select("title").order("created_at", { ascending: false }),
      ]);

      if (forecastResp.error) throw forecastResp.error;
      if (sentimentResp.error) console.warn("sentiment error", sentimentResp.error);
      if (anomaliesResp.error) console.warn("anomalies error", anomaliesResp.error);

      const forecast = (forecastResp.data as any)?.tickers ?? [];
      const companies = (sentimentResp.data as any)?.companies ?? [];
      const anomalies = (anomaliesResp.data as any)?.anomalies ?? [];
      const docTitles: string[] = (docsResp.data as any)?.map((d: any) => d.title) ?? [];

      const mapTickerToName: Record<string, string> = { WMT: "Walmart", MCD: "McDonald", ADBE: "Adobe" };

      const findSentiment = (sym: string) => {
        const guess = mapTickerToName[sym] || sym;
        const match = companies.find((c: any) => c.name?.toLowerCase().includes(guess.toLowerCase()));
        return typeof match?.score === "number" ? match.score : 0;
      };

      const countHighAnomalies = (sym: string) => {
        const guess = mapTickerToName[sym] || sym;
        return anomalies.filter((a: any) => (a.company || "").toLowerCase().includes(guess.toLowerCase()) && a.severity === "high").length;
      };

      const strategies = tickers.map((sym) => {
        const f = forecast.find((t: any) => t.symbol === sym);
        const exp = Number(f?.metrics?.expectedChangePct ?? 0);
        const vol = Number(f?.metrics?.volatility ?? 0);
        const trend = (f?.metrics?.trend as "up" | "down" | "flat") || "flat";
        const sent = findSentiment(sym);
        const highAnoms = countHighAnomalies(sym);

        let decision: "Buy" | "Sell" | "Hold" = "Hold";
        if (exp >= 5 && sent > 0.1 && highAnoms === 0) decision = "Buy";
        else if (exp <= -3 || sent < -0.2 || highAnoms > 0) decision = "Sell";

        let confidence = 60;
        confidence += Math.max(-10, Math.min(10, exp / 2));
        confidence += sent * 20; // -20..+20
        if (highAnoms > 0) confidence -= 15;
        if (trend === "up") confidence += 5; else if (trend === "down") confidence -= 5;
        confidence = Math.max(10, Math.min(95, confidence));

        const reasons: string[] = [];
        reasons.push(`30d forecast: ${exp.toFixed(2)}% (${trend} trend)`);
        reasons.push(`Volatility (σ): ${vol.toFixed(2)}%`);
        reasons.push(`Sentiment: ${sent.toFixed(2)}`);
        if (highAnoms > 0) reasons.push(`${highAnoms} high-severity anomaly${highAnoms > 1 ? "ies" : "y"} detected in filings`);

        const sources = [
          `Market data: Yahoo Finance (2y daily) for ${sym}`,
          ...(docTitles.length ? [
            `Uploaded documents (${docTitles.length}): ${docTitles.slice(0, 5).join(", ")}${docTitles.length > 5 ? "…" : ""}`,
          ] : []),
        ];

        return {
          symbol: sym,
          decision,
          confidence,
          metrics: { expectedChangePct: exp, volatility: vol, sentiment: sent, trend },
          reasons,
          sources,
        };
      });

      setStrategyResults(strategies);
      toast({ title: "Strategy ready", description: "Buy/Sell/Hold recommendations generated." });
    } catch (err: any) {
      console.error("Analyze error", err);
      toast({ title: "Error", description: err?.message || "Failed to analyze", variant: "destructive" });
    } finally {
      setAnalyzeLoading(false);
    }
  };

  return (
    <main className="min-h-screen py-16">
      <section className="container mx-auto max-w-5xl px-4">
        <div className="hero-surface p-10 mb-10">
          <div className="relative z-10 text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-bold">
              <span className="gradient-text">Financial RAG Analyst</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              SEC filings to insights: Q&A, sentiment, and anomaly detection for earnings reports and press releases.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="hero" size="lg" onClick={() => document.getElementById('file-input')?.click()}>Upload SEC PDFs</Button>
              <Button variant="outline" size="lg" asChild>
                <a href="#analyze">Analyze</a>
              </Button>
            </div>
          </div>
          <GradientOrb />
        </div>

        <input
          id="file-input"
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Document Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents yet. Add SEC PDFs to begin.</p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((d, i) => (
                    <li key={`${d.name}-${i}`} className="border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <span className="truncate mr-3">{d.name}</span>
                        <span className="text-xs text-muted-foreground">{(d.size / (1024*1024)).toFixed(2)} MB</span>
                      </div>
                      <div className="mt-2 space-y-1">
                        <Progress value={d.progress} />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{d.status}</span>
                          <span className="text-xs">{Math.round(d.progress)}%</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {docs.length > 0 && (
                <p className="text-xs text-muted-foreground">Total size: {(totalSize / (1024*1024)).toFixed(2)} MB</p>
              )}
            </CardContent>
          </Card>

          <Card id="analyze">
            <CardHeader>
              <CardTitle>Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="qa" className="w-full">
                <TabsList className="grid grid-cols-4">
                  <TabsTrigger value="qa">Q&A</TabsTrigger>
                  <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
                  <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
                  <TabsTrigger value="forecasting">Forecasting</TabsTrigger>
                </TabsList>
                <TabsContent value="qa" className="space-y-4">
                  <form onSubmit={handleAsk} className="space-y-3">
                    <Input
                      placeholder="E.g. What was total revenue this quarter?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    <Button type="submit">Ask</Button>
                  </form>
                </TabsContent>
                <TabsContent value="sentiment" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">Quantify tone in MD&A, earnings calls, and press releases.</p>
                    <Button variant="secondary" onClick={handleSentiment} disabled={sentimentLoading}>
                      {sentimentLoading ? "Running..." : "Run Sentiment"}
                    </Button>
                  </div>
                  <SentimentResults results={sentimentResults} />
                </TabsContent>
                <TabsContent value="anomalies" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground flex-1">Spot unusual metric changes across periods.</p>
                    <Button variant="secondary" onClick={handleAnomalies} disabled={anomaliesLoading}>
                      {anomaliesLoading ? "Scanning..." : "Scan Anomalies"}
                    </Button>
                  </div>
                  <AnomaliesResults anomalies={anomaliesResults} />
                </TabsContent>
                <TabsContent value="forecasting" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Input
                      placeholder="Tickers (comma separated)"
                      value={tickersInput}
                      onChange={(e) => setTickersInput(e.target.value)}
                    />
                    <Button variant="secondary" onClick={handleForecast} disabled={forecastLoading}>
                      {forecastLoading ? "Forecasting..." : "Run Forecast"}
                    </Button>
                    <Button onClick={handleAnalyze} disabled={analyzeLoading}>
                      {analyzeLoading ? "Analyzing..." : "Analyze Strategy"}
                    </Button>
                  </div>
                  <ForecastResults data={forecastResults} />
                  <StrategyResults results={strategyResults} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
};

export default Index;
