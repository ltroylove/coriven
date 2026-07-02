-- Grant API roles access to behavioral_constraints.
-- The original migration was applied without these grants; this catches up the remote.
GRANT SELECT, INSERT, UPDATE, DELETE ON behavioral_constraints TO anon, authenticated, service_role;
