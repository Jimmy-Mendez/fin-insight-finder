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
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
interface LocalDoc {
  id?: string;
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
  const [suggestedTickers, setSuggestedTickers] = useState<string[]>([]);
  const [summarizingDoc, setSummarizingDoc] = useState<string | null>(null);
  const [qaMessages, setQaMessages] = useState<{ role: "user" | "assistant" | "system"; content: string }[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const totalSize = useMemo(() => docs.reduce((a, d) => a + d.size, 0), [docs]);

  const updateDoc = (name: string, update: Partial<LocalDoc>) => {
    setDocs(prev => prev.map(d => (d.name === name ? { ...d, ...update } : d)));
  };

  const extractTickers = (text: string, fileName: string): string[] => {
    const MAX_TEXT = 60000;
    const sample = (text || "").slice(0, MAX_TEXT).toUpperCase();
    const bad = new Set([
      "SEC","USD","US","GAAP","EPS","EBITDA","NET","INCOME","LOSS","REVENUE","CASH","FLOW","BALANCE","SHEET",
      "Q","Q1","Q2","Q3","Q4","FY","FYE","K","S","MD&A","ITEM","NOTE","NOTES","FORM","10Q","10-K","8-K","EXHIBIT","SERIES","CLASS",
      // Common filename noise
      "PDF","DOC","DOCX","FINAL","DRAFT","REPORT","EARNINGS","TRANSCRIPT","CALL","PRESS","RELEASE","QUARTER","ANNUAL","V","V1","V2","V3"
    ]);
    const add = (tok: string, out: Set<string>) => {
      const t = tok.toUpperCase().trim();
      if (t.length >= 1 && t.length <= 5 && /^[A-Z]+$/.test(t) && !bad.has(t)) out.add(t);
    };
    const out = new Set<string>();

    const patterns: RegExp[] = [
      /TRADING SYMBOL\(S\)\s*:\s*([A-Z]{1,5})(?:\s*,\s*([A-Z]{1,5}))*?/g,
      /\bTICKER(?:\s*SYMBOL)?\s*[:\-]\s*([A-Z]{1,5})\b/g,
      /\bNASDAQ\s*:?[\s\-]*([A-Z]{1,5})\b/g,
      /\bNYSE\s*:?[\s\-]*([A-Z]{1,5})\b/g,
      /\bAMEX\s*:?[\s\-]*([A-Z]{1,5})\b/g
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(sample))) {
        for (let i = 1; i < m.length; i++) if (m[i]) add(m[i], out);
      }
    }

    // Only fall back to filename tokens if no tickers were found in content
    if (out.size === 0) {
      const nameTokens = (fileName || "").toUpperCase().split(/[^A-Z]/).filter(Boolean);
      for (const tok of nameTokens) add(tok, out);
    }

    return Array.from(out);
  };

  const addTickerToInput = (sym: string) => {
    const s = sym.toUpperCase();
    setTickersInput((prev) => {
      const parts = prev.split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase());
      if (parts.includes(s)) return prev;
      return parts.length ? `${parts.join(",")},${s}` : s;
    });
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

        const suggestions = extractTickers(text, file.name);
        if (suggestions.length) {
          setSuggestedTickers((prev) => Array.from(new Set([...prev, ...suggestions])));
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
        updateDoc(file.name, { id: doc.id });

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

    // Append user message and clear input
    setQaMessages((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setAskLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("generate-answer", {
        body: { question: q, document_id: currentDocId ?? undefined, top_k: 12 },
      });
      if (error) throw error;
      const answer: string = (data as any)?.answer ?? "No answer returned.";
      setQaMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err: any) {
      console.error("Q&A error", err);
      setQaMessages((prev) => [...prev, { role: "system", content: err?.message || "Failed to get answer" }]);
    } finally {
      setAskLoading(false);
    }
  };

  const handleSummarize = async (doc: LocalDoc) => {
    try {
      if (!doc.id) {
        toast({ title: "Not ready", description: "Please finish indexing before summarizing.", variant: "destructive" });
        return;
      }
      setSummarizingDoc(doc.id);
      toast({ title: "Summarizing", description: `Generating summary for ${doc.name}...` });
      const { data, error } = await supabase.functions.invoke("generate-answer", {
        body: {
          question: "Provide a concise executive summary focusing on key financial metrics, risks, and outlook. Use up to 5 short bullet points.",
          document_id: doc.id,
          top_k: 12,
        },
      });
      if (error) throw error;
      const summary: string = (data as any)?.answer ?? "No summary returned.";
      toast({
        title: `Summary: ${doc.name}`,
        description: (
          <div className="text-sm">
            <ReactMarkdown
              components={{
                ul: ({ node, ...props }) => <ul className="list-disc pl-5" {...props} />,
                ol: ({ node, ...props }) => <ol className="list-decimal pl-5" {...props} />,
                p: ({ node, ...props }) => <p className="mb-2" {...props} />,
                a: ({ node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />
                ),
              }}
            >
              {summary}
            </ReactMarkdown>
          </div>
        ),
      });
    } catch (err: any) {
      console.error("Summarize error", err);
      toast({ title: "Error", description: err?.message || "Failed to summarize document", variant: "destructive" });
    } finally {
      setSummarizingDoc(null);
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
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{(d.size / (1024*1024)).toFixed(2)} MB</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSummarize(d)}
                            disabled={!d.id || d.progress < 100 || summarizingDoc === d.id}
                          >
                            {summarizingDoc === d.id ? "Summarizing..." : "Summarize"}
                          </Button>
                        </div>
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
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="qa">Q&amp;A</TabsTrigger>
                  <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
                  <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
                </TabsList>
                <TabsContent value="qa" className="space-y-4">
                  <div className="border rounded-md">
                    <ScrollArea className="h-64 p-3">
                      <div className="space-y-2">
                        {qaMessages.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Ask a question about your uploaded documents.</p>
                        ) : (
                          qaMessages.map((m, idx) => (
                            <div
                              key={idx}
                              className={[
                                "text-sm",
                                m.role === "user" ? "text-right" : "",
                                m.role === "system" ? "text-amber-600 dark:text-amber-400" : "",
                              ].join(" ")}
                            >
                              <span className="inline-block rounded-md px-3 py-2 bg-muted">{m.content}</span>
                            </div>
                          ))
                        )}
                        {askLoading && (
                          <div className="text-sm animate-fade-in">
                            <span className="inline-flex items-center gap-1 rounded-md px-3 py-2 bg-muted">
                              <span className="sr-only">Assistant is thinking</span>
                              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-pulse"></span>
                              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-pulse"></span>
                              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-pulse"></span>
                            </span>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                  <form onSubmit={handleAsk} className="flex items-center gap-2">
                    <Input
                      placeholder="E.g. What was total revenue this quarter?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    <Button type="submit" disabled={askLoading || !question.trim()}>
                      {askLoading ? "Asking..." : "Ask"}
                    </Button>
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
              </Tabs>
            </CardContent>
          </Card>
          <Card id="forecast">
            <CardHeader>
              <CardTitle>Forecasting & Strategy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {suggestedTickers.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-1">Suggested from docs:</span>
                  {suggestedTickers.map((s) => (
                    <Button key={s} variant="outline" size="sm" onClick={() => addTickerToInput(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              )}
              <ForecastResults data={forecastResults} />
              <StrategyResults results={strategyResults} />
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
};

export default Index;
