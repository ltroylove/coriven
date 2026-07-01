-- Drop and recreate match_memories with auth.uid() guard
-- Use extensions.vector to qualify the type — on Supabase, pgvector lives in the
-- extensions schema and the type must be resolvable at function-creation time.
SET search_path TO extensions, public, auth;

DROP FUNCTION IF EXISTS match_memories(extensions.vector, float, int, uuid);
DROP FUNCTION IF EXISTS match_memories(vector, float, int, uuid);

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int,
  match_user_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public, extensions
SECURITY DEFINER
AS $$
BEGIN
  -- Prevent cross-user reads: only allow service_role or owner
  IF auth.uid() IS NOT NULL AND auth.uid() <> match_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.content,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE
    m.user_id = match_user_id
    AND m.superseded_by IS NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
