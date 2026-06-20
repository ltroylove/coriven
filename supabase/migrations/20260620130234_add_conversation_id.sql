ALTER TABLE conversation_messages
  ADD COLUMN conversation_id uuid;

DROP INDEX IF EXISTS conversation_messages_user_id_idx;

CREATE INDEX conversation_messages_user_id_idx
  ON conversation_messages (user_id, conversation_id, created_at ASC);
