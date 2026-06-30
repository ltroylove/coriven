-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Enum
CREATE TYPE entity_profile_type AS ENUM ('person', 'place', 'project', 'thing', 'resource');

-- updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

-- entity_profiles
CREATE TABLE IF NOT EXISTS entity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type entity_profile_type NOT NULL DEFAULT 'person',
  description text,
  aliases text[] NOT NULL DEFAULT '{}',
  last_mentioned timestamptz,
  mention_count int NOT NULL DEFAULT 0,
  recency_weight float NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE entity_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entity_profiles_owner" ON entity_profiles USING (user_id = auth.uid());
CREATE TRIGGER entity_profiles_updated_at BEFORE UPDATE ON entity_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- memories
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536),
  superseded_by uuid REFERENCES memories(id),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memories_owner" ON memories USING (user_id = auth.uid());
CREATE TRIGGER memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- user_context (one row per user)
CREATE TABLE IF NOT EXISTS user_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}',
  facts jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_context_owner" ON user_context USING (user_id = auth.uid());
CREATE TRIGGER user_context_updated_at BEFORE UPDATE ON user_context FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- conversation_summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  summary text NOT NULL,
  message_range int4range,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversation_summaries_owner" ON conversation_summaries USING (user_id = auth.uid());

-- sentinel_context (one row per user, service-role writes)
CREATE TABLE IF NOT EXISTS sentinel_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  package jsonb,
  built_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sentinel_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sentinel_context_owner_read" ON sentinel_context FOR SELECT USING (user_id = auth.uid());
-- Service role bypasses RLS for writes (Sentinel async writer)
