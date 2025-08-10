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
    const { question, top_k, document_id, context } = await req.json();

    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "'question' is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: { persistSession: false },
    });

    // 1) Create question embedding (prefix for BGE/E5 models)
    const embedInput = `query: ${question}`;
    const { data: embedData, error: embedErr } = await supabase.functions.invoke("embed-text", {
      body: { texts: [embedInput] },
    });
    if (embedErr || !embedData?.embeddings?.[0]) {
      console.error("embed-text error:", embedErr || embedData);
      return new Response(JSON.stringify({ error: "Embedding generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const queryEmbedding = embedData.embeddings[0] as number[];

    // 2) Retrieve top matching chunks
    const k = typeof top_k === "number" && top_k > 0 && top_k <= 20 ? top_k : 6;
    const { data: matches, error: matchErr } = await supabase.rpc("match_document_chunks", {
      query_embedding: queryEmbedding,
      match_count: k,
      filter_document_id: document_id ?? null,
    });

    if (matchErr) {
      console.error("match_document_chunks error:", matchErr);
      return new Response(JSON.stringify({ error: "Retrieval failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const retrievedContext = (matches ?? [])
      .map((m: any) => `Chunk #${m.chunk_index} (doc ${m.document_id}):\n${m.content}`)
      .join("\n---\n");

    // 3) Call OpenAI with retrieved context
    const messages = [
      {
        role: "system",
        content:
          "You are a financial analysis assistant for SEC filings. Use the provided CONTEXT to answer. Be concise and cite figures directly.",
      },
      { role: "system", content: `CONTEXT:\n${retrievedContext}${context ? `\n\nEXTRA CONTEXT:\n${context}` : ""}` },
      { role: "user", content: question },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI error:", err);
      return new Response(JSON.stringify({ error: "OpenAI request failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        answer,
        citations: (matches ?? []).map((m: any) => ({
          id: m.id,
          document_id: m.document_id,
          chunk_index: m.chunk_index,
          similarity: m.similarity,
          content: m.content,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("generate-answer error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
