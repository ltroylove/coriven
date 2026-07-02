-- Two security fixes for match_memories:
-- 1. Drop the original 3-arg overload (no auth guard, SECURITY DEFINER — any caller could
--    pass an arbitrary match_user_id and read another user's memories).
-- 2. Recreate the 4-arg function with a corrected auth guard that also rejects anonymous
--    callers (auth.uid() IS NULL when no valid JWT is present).
SET LOCAL search_path TO extensions, public, auth;

DROP FUNCTION IF EXISTS public.match_memories(extensions.vector(1536), uuid, int);

CREATE OR REPLACE FUNCTION public.match_memories(
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
  -- Service role is trusted; all other callers must present a valid JWT that matches the
  -- requested user_id.  auth.role() reads the `role` claim from the JWT.
  IF auth.role() = 'service_role' THEN
    NULL; -- allowed
  ELSIF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  ELSIF auth.uid() <> match_user_id THEN
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
    AND m.source IS DISTINCT FROM 'tombstone'
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
