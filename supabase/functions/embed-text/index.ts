import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const hfKey = Deno.env.get("HUGGINGFACE_API_KEY");
const MODEL_ID = "BAAI/bge-m3";

function meanPool(tokens: number[][]): number[] {
  const rows = tokens.length;
  const cols = tokens[0].length;
  const out = new Array(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    const row = tokens[i];
    for (let j = 0; j < cols; j++) out[j] += row[j];
  }
  for (let j = 0; j < cols; j++) out[j] /= rows;
  return out;
}

function l2norm(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!hfKey) {
    return new Response(JSON.stringify({ error: "Missing HUGGINGFACE_API_KEY" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { texts } = await req.json();
    let arr: string[] = [];
    if (typeof texts === "string") arr = [texts];
    else if (Array.isArray(texts)) arr = texts.filter((t) => typeof t === "string");

    if (arr.length === 0) {
      return new Response(JSON.stringify({ error: "'texts' must be string or string[]" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call HF with small retry for cold starts / rate limits
    const maxRetries = 3;
    let resp: Response | null = null;
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      // Prefer the HF router feature-extraction endpoint per latest docs; fallback to API Inference
      resp = await fetch(`https://router.huggingface.co/hf-inference/models/${MODEL_ID}/pipeline/feature-extraction`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: arr, options: { wait_for_model: true } }),
      });

      if (!resp.ok && resp.status === 404) {
        resp = await fetch(`https://api-inference.huggingface.co/pipeline/feature-extraction/${MODEL_ID}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: arr, options: { wait_for_model: true } }),
        });
      }

      if (resp.ok) break;

      // Retry on common transient statuses
      if ([429, 500, 502, 503, 504].includes(resp.status)) {
        const delay = 400 * attempt; // 400ms, 800ms, 1200ms
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!resp || !resp.ok) {
      const err = resp ? await resp.text() : "no response";
      console.error("HF error:", err);
      return new Response(JSON.stringify({ error: "Hugging Face request failed", details: err }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await resp.json();

    // Normalize output to batch of embeddings from various HF formats
    let embeddings: number[][] = [];
    try {
      if (raw && Array.isArray(raw.embeddings)) {
        // HF /embeddings may return { embeddings: number[] } or number[][]
        if (raw.embeddings.length > 0 && typeof raw.embeddings[0] === "number") {
          embeddings = [l2norm(raw.embeddings as number[])];
        } else {
          embeddings = (raw.embeddings as number[][]).map((e) => l2norm(e));
        }
      } else if (raw && Array.isArray(raw.data) && raw.data[0]?.embedding) {
        // Some responses use { data: [{ embedding: number[] }, ...] }
        embeddings = (raw.data as any[]).map((d) => l2norm(d.embedding as number[]));
      } else if (Array.isArray(raw) && typeof raw[0] === "number") {
        // Single flat vector
        embeddings = [l2norm(raw as number[])];
      } else if (Array.isArray(raw) && Array.isArray(raw[0]) && typeof raw[0][0] === "number") {
        // Single input: tokens x dims (feature-extraction)
        embeddings = [l2norm(meanPool(raw as number[][]))];
      } else if (
        Array.isArray(raw) &&
        Array.isArray(raw[0]) &&
        Array.isArray(raw[0][0]) &&
        typeof raw[0][0][0] === "number"
      ) {
        // Batch: batch x tokens x dims (feature-extraction)
        embeddings = (raw as number[][][]).map((tokens) => l2norm(meanPool(tokens)));
      } else {
        console.error("Unexpected HF output shape", raw);
        return new Response(JSON.stringify({ error: "Unexpected embeddings format" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      console.error("Failed to parse HF embeddings:", e, raw);
      return new Response(JSON.stringify({ error: "Failed to parse embeddings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ model: MODEL_ID, embeddings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("embed-text error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
