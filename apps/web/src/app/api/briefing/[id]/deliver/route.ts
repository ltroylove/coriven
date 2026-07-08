/**
 * POST /api/briefing/[id]/deliver
 *
 * Marks a daily_briefings row as delivered (was_delivered = true).
 * Used by the tray after firing a native notification for any briefing type
 * (daily or weekly).
 *
 * Security: RLS-enforced via the user's session token. The row must belong to
 * the authenticated user; foreign rows return 404.
 * Idempotent: calling this on an already-delivered row is a no-op (200 returned).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Authenticate
  const supabase = await createApiServerClient(request)
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Missing briefing id' }, { status: 400 })
  }

  // 2. Verify the row exists and belongs to this user
  const { data: row, error: fetchError } = await supabase
    .from('daily_briefings')
    .select('id, was_delivered')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 3. Idempotent — already delivered, return success
  if (row.was_delivered) {
    return NextResponse.json({ delivered: true })
  }

  // 4. Mark delivered
  const { error: updateError } = await supabase
    .from('daily_briefings')
    .update({ was_delivered: true, delivered_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    console.error(
      JSON.stringify({
        event: 'api.briefing.deliver.update_error',
        userId: user.id,
        briefingId: id,
        error: updateError.message,
      }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ delivered: true })
}
