-- Add unique constraint required for upsert ON CONFLICT (user_id, name)
ALTER TABLE entity_profiles
  ADD CONSTRAINT entity_profiles_user_id_name_key UNIQUE (user_id, name);
