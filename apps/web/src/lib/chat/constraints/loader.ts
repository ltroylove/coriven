// Constraints are loaded by exact DB query, not vector similarity — this is intentional
// per ADR-007. Do not route through the memory/embedding pipeline.
import { createServiceClient } from '@/lib/supabase/server'
import type { BehavioralConstraint } from '@personal-assistant/types'

export async function loadConstraintsForUser(
  userId: string,
  scope?: string,
): Promise<BehavioralConstraint[]> {
  const db = createServiceClient()

  let query = db
    .from('behavioral_constraints')
    .select('id, user_id, rule, rationale, scope, is_locked, created_at, updated_at')
    .eq('user_id', userId)
    .order('is_locked', { ascending: false })
    .order('created_at', { ascending: true })

  if (scope) {
    query = query.or(`scope.eq.${scope},scope.eq.all`)
  }

  const { data, error } = await query

  if (error) {
    console.error(JSON.stringify({ event: 'constraint_load_error', userId, error: error.message }))
    throw error
  }

  return (data ?? []) as BehavioralConstraint[]
}
