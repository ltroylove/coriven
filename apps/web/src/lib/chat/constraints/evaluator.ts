import type { BehavioralConstraint } from '@personal-assistant/types'

export type ConstraintEvalResult =
  | { matched: false }
  | { matched: true; constraint: BehavioralConstraint; isLocked: boolean }

// Pure function — no DB calls, no side effects.
// Caller loads constraints once per engine turn; this is called per tool block.
export function evaluateConstraint(
  toolName: string,
  toolInput: Record<string, unknown>,
  constraints: BehavioralConstraint[],
): ConstraintEvalResult {
  if (constraints.length === 0) return { matched: false }

  const inputText = JSON.stringify(toolInput).toLowerCase()
  const toolLower = toolName.toLowerCase()

  // Locked constraints first; ties broken by created_at ascending (oldest rule wins)
  const ordered = [...constraints].sort((a, b) => {
    const lockDiff = (b.is_locked ? 1 : 0) - (a.is_locked ? 1 : 0)
    if (lockDiff !== 0) return lockDiff
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })

  for (const constraint of ordered) {
    const ruleLower = constraint.rule.toLowerCase()
    const scopeLower = constraint.scope.toLowerCase()

    // Scope filter: 'all' always applies; specific scope must appear in toolName or input
    const scopeMatches =
      scopeLower === 'all' ||
      toolLower.includes(scopeLower) ||
      inputText.includes(scopeLower)

    if (!scopeMatches) continue

    // Rule match: any term from the rule found in toolName or serialized input
    const ruleTerms = ruleLower.split(/\s+/).filter(t => t.length > 3)
    const ruleMatches = ruleTerms.some(term => toolLower.includes(term) || inputText.includes(term))

    if (ruleMatches) {
      return { matched: true, constraint, isLocked: constraint.is_locked }
    }
  }

  return { matched: false }
}
