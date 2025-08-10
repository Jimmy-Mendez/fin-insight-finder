import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

export const AnalysisTabs = () => {
  const [question, setQuestion] = useState("");

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    toast({ title: "Backend not connected", description: "Connect Supabase to enable RAG Q&A." });
  };

  return (
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
        <Button variant="secondary" onClick={() => toast({ title: 'Sentiment queued', description: 'Will run once backend is connected.' })}>Run Sentiment</Button>
      </TabsContent>
      <TabsContent value="anomalies" className="space-y-3">
        <p className="text-sm text-muted-foreground">Spot unusual metric changes across periods.</p>
        <Button variant="secondary" onClick={() => toast({ title: 'Anomaly scan queued', description: 'Will run once backend is connected.' })}>Scan Anomalies</Button>
      </TabsContent>
    </Tabs>
  );
};
