-- Move vector extension to the recommended `extensions` schema and ensure it exists
DO $$
DECLARE ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF ext_schema IS NULL THEN
    -- Not installed yet: install into extensions schema
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  ELSIF ext_schema <> 'extensions' THEN
    -- Installed in another schema (likely public): move it
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END $$;

-- Recreate function with fixed search_path for security
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(1024),
  match_count INT DEFAULT 5,
  filter_document_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
$$;

-- Ensure column type references the relocated extension type transparently
-- (no-op if already correct, since `vector` is on search_path)
ALTER TABLE public.document_chunks
  ALTER COLUMN embedding TYPE extensions.vector(1024);
