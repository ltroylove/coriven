/**
 * POST /api/patterns/[id]/acknowledge
 *
 * Sets last_notified_at = now() for the specified pattern, recording that
 * the user was notified. The frequency cap in GET /api/patterns/new uses this
 * field to suppress re-notifications within 7 days.
 *
 * RLS enforces that users can only update their own patterns. The endpoint adds
 * a user_id filter as defense-in-depth.
 *
 * Response 200: { acknowledged: true }
 * Response 401: { error: 'Unauthorized' }
 * Response 404: { error: 'Pattern not found' }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate
  const supabase = await createApiServerClient(request)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: patternId } = await context.params

  if (!patternId) {
    return NextResponse.json({ error: 'Pattern ID is required' }, { status: 400 })
  }

  // 2. Update last_notified_at — scoped to user for defense-in-depth
  const now = new Date().toISOString()
  const { data, error: updateError } = await supabase
    .from('detected_patterns')
    .update({ last_notified_at: now, updated_at: now })
    .eq('id', patternId)
    .eq('user_id', user.id) // RLS also enforces this
    .eq('is_active', true)
    .select('id')
    .single()

  if (updateError || !data) {
    // Row not found or RLS rejected — treat as 404
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 })
  }

  console.log(
    JSON.stringify({
      event: 'api.patterns.acknowledge',
      userId: user.id,
      patternId,
    }),
  )

  return NextResponse.json({ acknowledged: true })
}
