import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const openAIApiKey = Deno.env.get("OPENAI_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function safeParseJSON<T>(text: string): T | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const json = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    return JSON.parse(json) as T;
  } catch (_e) {
    return null;
  }
}

type Anomaly = {
  company?: string;
  metric: string;
  period?: string;
  change?: string; // e.g., "-12% YoY" or "+$1.2B"
  severity?: "low" | "medium" | "high";
  rationale?: string;
  document?: string; // title
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!openAIApiKey || !supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing required server env: OPENAI_API_KEY/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { limit_docs } = await req.json().catch(() => ({ limit_docs: undefined }));

    const supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!, { auth: { persistSession: false } });

    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select("id,title,created_at")
      .order("created_at", { ascending: false })
      .limit(typeof limit_docs === "number" && limit_docs > 0 ? limit_docs : 50);

    if (docErr) {
      console.error("analyze-anomalies: documents fetch error", docErr);
      return new Response(JSON.stringify({ error: "Failed to fetch documents" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!docs || docs.length === 0) {
      return new Response(JSON.stringify({ anomalies: [], info: "No documents found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const all: Anomaly[] = [];

    for (const doc of docs) {
      const { data: chunks, error: chErr } = await supabase
        .from("document_chunks")
        .select("content,chunk_index")
        .eq("document_id", doc.id)
        .order("chunk_index", { ascending: true })
        .limit(120);

      if (chErr) {
        console.error("analyze-anomalies: chunks fetch error", chErr);
        continue;
      }

      const fullText = (chunks ?? []).map((c: any) => c.content).join("\n\n");
      if (!fullText) continue;
      const text = fullText.slice(0, 18000);

      const messages = [
        {
          role: "system",
          content:
            "You are a financial forensic analyst. From the provided SEC filing excerpts, detect anomalies in financial metrics that could signal risks (e.g., sharp revenue declines, margin compression, negative FCF, debt spikes, inventory build, receivables growth, customer churn, guidance cuts). Return compact JSON only.",
        },
        {
          role: "user",
          content:
            `Document Title: ${doc.title}\n---\n${text}\n---\nReturn JSON with shape: { anomalies: [ { company?: string, metric: string, period?: string, change?: string, severity?: "low"|"medium"|"high", rationale?: string } ] }\n- Strictly numeric-backed or clearly stated anomalies only.\n- Avoid duplicates.\n- Severity based on potential risk exposure.\n- Keep rationale very brief (<= 160 chars).`,
        },
      ];

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAIApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.1, messages }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("analyze-anomalies: OpenAI error", errText);
        continue;
      }

      const data = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJSON<{ anomalies: Anomaly[] }>(content) ?? { anomalies: [] };

      for (const a of parsed.anomalies || []) {
        all.push({ ...a, document: doc.title });
      }
    }

    // Optional: simple de-dup by key
    const deDuped: Record<string, Anomaly> = {};
    for (const a of all) {
      const key = `${(a.company || "?").toLowerCase()}|${a.metric.toLowerCase()}|${(a.period || "").toLowerCase()}|${a.change || ""}`;
      if (!deDuped[key]) deDuped[key] = a;
    }

    return new Response(JSON.stringify({ anomalies: Object.values(deDuped) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("analyze-anomalies error", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
