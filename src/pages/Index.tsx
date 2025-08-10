import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { GradientOrb } from "@/components/GradientOrb";
import { supabase } from "@/integrations/supabase/client";

interface LocalDoc {
  name: string;
  size: number;
}

const Index = () => {
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [question, setQuestion] = useState("");

  const totalSize = useMemo(() => docs.reduce((a, d) => a + d.size, 0), [docs]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).filter(f => f.type === "application/pdf");
    if (accepted.length === 0) {
      toast({ title: "Only PDFs allowed", variant: "destructive" });
      return;
    }
    setDocs(prev => [
      ...prev,
      ...accepted.map(f => ({ name: f.name, size: f.size }))
    ]);
    toast({ title: "Documents added", description: `${accepted.length} PDF(s) queued` });
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    toast({ title: "Asking OpenAI...", description: "Generating answer" });
    try {
      const { data, error } = await supabase.functions.invoke("generate-answer", {
        body: { question: q },
      });
      if (error) throw error;
      const answer: string = data?.answer ?? "No answer returned.";
      toast({ title: "Answer", description: answer });
    } catch (err: any) {
      console.error("Q&A error", err);
      toast({ title: "Error", description: err?.message || "Failed to get answer", variant: "destructive" });
    }
  };

  const handleSentiment = () => {
    toast({ title: "Sentiment queued", description: "Will run once backend is connected." });
  };

  const handleAnomalies = () => {
    toast({ title: "Anomaly scan queued", description: "Will run once backend is connected." });
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
                    <li key={`${d.name}-${i}`} className="flex items-center justify-between border rounded-md p-3">
                      <span className="truncate mr-3">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{(d.size / (1024*1024)).toFixed(2)} MB</span>
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
                  <TabsTrigger value="qa">Q&A</TabsTrigger>
                  <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
                  <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
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
                <TabsContent value="sentiment" className="space-y-3">
                  <p className="text-sm text-muted-foreground">Quantify tone in MD&A, earnings calls, and press releases.</p>
                  <Button variant="secondary" onClick={handleSentiment}>Run Sentiment</Button>
                </TabsContent>
                <TabsContent value="anomalies" className="space-y-3">
                  <p className="text-sm text-muted-foreground">Spot unusual metric changes across periods.</p>
                  <Button variant="secondary" onClick={handleAnomalies}>Scan Anomalies</Button>
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
