-- Migration: seed search_email_metadata into tool_permissions
-- Wave 7.4.1 — search_email_metadata tool (Task 7.4.1.3.1)
--
-- The search_email_metadata tool searches email metadata (subject, sender,
-- urgency, date) by keyword for cross-context queries.
--
-- Seeding strategy:
--   - Users with a connected Gmail integration get the tool enabled by default.
--   - Users without a Gmail integration get the row inserted but disabled,
--     so they can enable it if they later connect Gmail.
--   - Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO public.tool_permissions (user_id, tool_name, enabled)
SELECT
  u.id,
  'search_email_metadata',
  -- Enable for users who have a gmail integration connected
  EXISTS (
    SELECT 1
    FROM public.integrations i
    WHERE i.user_id = u.id
      AND i.provider = 'gmail'
  )
FROM auth.users u
ON CONFLICT (user_id, tool_name) DO NOTHING;
