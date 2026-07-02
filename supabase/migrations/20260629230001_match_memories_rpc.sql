CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE(id uuid, content text, similarity float)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    m.id,
    m.content,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.user_id = match_user_id
    AND m.superseded_by IS NULL
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;
