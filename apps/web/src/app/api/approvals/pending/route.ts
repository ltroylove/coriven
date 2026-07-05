import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import type { PendingApprovalsResponse } from '@personal-assistant/types'

/**
 * GET /api/approvals/pending
 *
 * Returns a minimal pending-approval summary for the authenticated user.
 * Only status = 'pending' items are included, ordered newest first.
 *
 * Security (ADR-013 §Security): the `payload` and `ai_summary` columns are
 * NEVER selected or returned. This is structural, not a post-hoc filter — only
 * the whitelisted columns (id, action_type, provider, created_at) are queried.
 * Raw payload review remains the web /approvals page exclusively.
 *
 * Empty queue → 200 { count: 0, items: [] }  (NOT 404 — tray poller must not
 * need a 404 special-case; "nothing pending" is data, not absence).
 */
export async function GET(): Promise<NextResponse<PendingApprovalsResponse | { error: string }>> {
  // 1. Authenticate — RLS-scoped client; no user → 401
  const supabase = await createAuthServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Whitelist-select ONLY: id, action_type, provider, created_at
  //    payload and ai_summary are intentionally excluded (ADR-013 §Security).
  //    RLS enforces user_id scoping at the DB layer — no application-level filter needed.
  const { data: rows, error: fetchError } = await supabase
    .from('approval_queue')
    .select('id, action_type, provider, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (fetchError) {
    console.error(
      JSON.stringify({
        event: 'api.approvals.pending.fetch_error',
        userId: user.id,
        error: fetchError.message,
      }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const items = (rows ?? []) as PendingApprovalsResponse['items']

  return NextResponse.json({ count: items.length, items })
}
