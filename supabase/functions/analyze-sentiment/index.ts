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

// Helper to safely parse model JSON
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

type CompanyDocSentiment = { name: string; score: number; confidence?: number };

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

    // Fetch all documents (most recent first). Optional soft cap for safety
    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select("id,title,created_at")
      .order("created_at", { ascending: false })
      .limit(typeof limit_docs === "number" && limit_docs > 0 ? limit_docs : 50);

    if (docErr) {
      console.error("analyze-sentiment: documents fetch error", docErr);
      return new Response(JSON.stringify({ error: "Failed to fetch documents" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!docs || docs.length === 0) {
      return new Response(JSON.stringify({ companies: [], info: "No documents found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, { total: number; count: number; documents: Set<string> }> = {};

    for (const doc of docs) {
      const { data: chunks, error: chErr } = await supabase
        .from("document_chunks")
        .select("content,chunk_index")
        .eq("document_id", doc.id)
        .order("chunk_index", { ascending: true })
        .limit(80);

      if (chErr) {
        console.error("analyze-sentiment: chunks fetch error", chErr);
        continue;
      }

      const fullText = (chunks ?? []).map((c: any) => c.content).join("\n\n");
      if (!fullText) continue;

      const text = fullText.slice(0, 16000); // keep within token budget

      const messages = [
        {
          role: "system",
          content:
            "You are a precise financial NLP tool. Extract company names mentioned in the document text and assign an overall sentiment score for each company based on the narrative (earnings, guidance, risk). Return minified JSON only.",
        },
        {
          role: "user",
          content:
            `Document Title: ${doc.title}\n---\n${text}\n---\nReturn JSON with shape: {\n  companies: [ { name: string, score: number, confidence?: number } ]\n}\n- score must be a float in [-1,1] (negative = bearish, positive = bullish).\n- Only include proper company entities (e.g., "Apple Inc.", "Microsoft Corporation").\n- If none, return { companies: [] }.`,
        },
      ];

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAIApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.1, messages }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("analyze-sentiment: OpenAI error", errText);
        continue;
      }

      const data = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJSON<{ companies: CompanyDocSentiment[] }>(content) ?? { companies: [] };

      for (const c of parsed.companies || []) {
        const key = c.name.trim().toLowerCase();
        if (!key) continue;
        if (!results[key]) results[key] = { total: 0, count: 0, documents: new Set<string>() };
        results[key].total += Number(c.score) || 0;
        results[key].count += 1;
        results[key].documents.add(doc.title);
      }
    }

    const companies = Object.entries(results)
      .map(([key, v]) => ({
        name: key.replace(/\b(inc\.?|corp\.?|corporation|ltd\.?|plc)\b/gi, (m) => (m.endsWith(".") ? m : m + "."))
          .replace(/\s+\./g, ".")
          .replace(/\b\w/g, (s) => s.toUpperCase()),
        score: Number((v.total / Math.max(1, v.count)).toFixed(3)),
        documents: Array.from(v.documents),
        count: v.count,
      }))
      .sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({ companies }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("analyze-sentiment error", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
