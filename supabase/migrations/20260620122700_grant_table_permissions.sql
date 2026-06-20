-- Grant table-level permissions to PostgREST roles.
-- Required in local dev because auto_expose_new_tables is disabled.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON TABLE profiles              TO anon, authenticated, service_role;
GRANT ALL ON TABLE tasks                 TO anon, authenticated, service_role;
GRANT ALL ON TABLE reminders             TO anon, authenticated, service_role;
GRANT ALL ON TABLE tool_permissions      TO anon, authenticated, service_role;
GRANT ALL ON TABLE conversation_messages TO anon, authenticated, service_role;
