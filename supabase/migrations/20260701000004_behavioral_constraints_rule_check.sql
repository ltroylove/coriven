-- Add non-empty CHECK on behavioral_constraints.rule (mirrors the rationale constraint).
-- Prevents blank/whitespace-only rules from being inserted via direct DB/API access.
ALTER TABLE behavioral_constraints
  ADD CONSTRAINT behavioral_constraints_rule_nonempty
  CHECK (length(trim(rule)) > 0);
