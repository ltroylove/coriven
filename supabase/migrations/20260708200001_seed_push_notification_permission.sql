-- Migration: seed push_notification into tool_permissions for all existing users
-- Wave 7.2.1 — push_notification tool
--
-- The push_notification tool allows the chat engine to create a tray notification
-- on demand. It does not require user approval (it is not an external-world action)
-- and is granted to all existing users by default.
-- Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO public.tool_permissions (user_id, tool_name, enabled)
SELECT id, 'push_notification', true
FROM auth.users
ON CONFLICT (user_id, tool_name) DO NOTHING;
