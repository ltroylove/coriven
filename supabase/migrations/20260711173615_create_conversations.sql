-- =============================================================================
-- Wave 9.1.2 — Conversation Unification (contract C1)
-- Create the conversations table, RLS, grants, backfill from existing messages,
-- FK from conversation_messages.conversation_id, and the list-ordering index.
-- Idempotent and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(), -- client-generated UUIDs are honored (explicit id on insert)
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text,                                              -- null until first user message
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  pinned_at   timestamptz,                                       -- schema-ready for pin (UI later)
  archived_at timestamptz                                        -- schema-ready for archive (UI later)
);

COMMENT ON TABLE conversations IS 'One row per chat conversation; server-owned lifecycle (create-on-first-message, title, updated_at). Contract C1.';

-- List-ordering index: user's conversations, pinned first, then most-recently-active.
CREATE INDEX IF NOT EXISTS conversations_user_list_idx
  ON conversations (user_id, pinned_at DESC NULLS LAST, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security (mirrors conversation_messages; adds UPDATE for title/pin/archive)
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversations"   ON conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON conversations;

CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants (project convention: PostgREST roles need explicit table grants)
-- ---------------------------------------------------------------------------
GRANT ALL ON TABLE conversations TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: one conversations row per distinct non-null conversation_id.
-- title      = earliest user-role message content (truncated ~80 chars)
-- created_at = earliest message, updated_at = latest message
-- Idempotent via ON CONFLICT (id) DO NOTHING.
-- ---------------------------------------------------------------------------
INSERT INTO conversations (id, user_id, title, created_at, updated_at)
SELECT
  m.conversation_id AS id,
  -- user_id is identical across a conversation's messages; MIN picks it deterministically
  MIN(m.user_id::text)::uuid AS user_id,
  LEFT(
    (
      SELECT um.content
      FROM conversation_messages um
      WHERE um.conversation_id = m.conversation_id
        AND um.role = 'user'
      ORDER BY um.created_at ASC
      LIMIT 1
    ),
    80
  ) AS title,
  MIN(m.created_at) AS created_at,
  MAX(m.created_at) AS updated_at
FROM conversation_messages m
WHERE m.conversation_id IS NOT NULL
GROUP BY m.conversation_id
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- FK: conversation_messages.conversation_id -> conversations.id
-- Column REMAINS nullable (historical rows with null conversation_id untouched).
-- Every non-null conversation_id now has a parent row (backfilled above), so the
-- constraint validates. ON DELETE SET NULL preserves message history if a
-- conversation is ever hard-deleted.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_conversation_id_fkey'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT conversation_messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
  END IF;
END $$;
