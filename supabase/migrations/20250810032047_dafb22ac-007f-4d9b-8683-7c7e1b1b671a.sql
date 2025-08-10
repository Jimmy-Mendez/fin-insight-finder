-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table to track sources
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chunks table with 1024-dim embeddings for BAAI/bge-m3
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_document
  ON public.document_chunks(document_id);

-- Vector index for fast ANN search (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON public.document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS: public demo-friendly (no auth yet). Adjust later if adding auth.
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'Public read documents'
  ) THEN
    CREATE POLICY "Public read documents" ON public.documents FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'Public insert documents'
  ) THEN
    CREATE POLICY "Public insert documents" ON public.documents FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'document_chunks' AND policyname = 'Public read chunks'
  ) THEN
    CREATE POLICY "Public read chunks" ON public.document_chunks FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'document_chunks' AND policyname = 'Public insert chunks'
  ) THEN
    CREATE POLICY "Public insert chunks" ON public.document_chunks FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Simple similarity search helper for RAG
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding VECTOR(1024),
  match_count INT DEFAULT 5,
  filter_document_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INT,
  content TEXT,
  similarity FLOAT
) AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <#> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE filter_document_id IS NULL OR dc.document_id = filter_document_id
  ORDER BY dc.embedding <#> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;