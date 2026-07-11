-- Migration: seed generate_weekly_review into tool_permissions for all existing users
-- Wave 7.3.1 — generate_weekly_review tool
--
-- The generate_weekly_review tool lets the chat engine retrieve or assemble the
-- user's weekly review on demand. It is granted to all existing users by default.
-- Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO public.tool_permissions (user_id, tool_name, enabled)
SELECT id, 'generate_weekly_review', true
FROM auth.users
ON CONFLICT (user_id, tool_name) DO NOTHING;
