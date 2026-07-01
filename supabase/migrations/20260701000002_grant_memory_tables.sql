-- Grant API roles access to memory tables.
-- The memory schema migration enabled RLS but omitted explicit grants;
-- createAuthServerClient() needs these to read/write without service-role bypass.
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_profiles       TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON memories              TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_context          TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_summaries TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sentinel_context      TO anon, authenticated, service_role;
