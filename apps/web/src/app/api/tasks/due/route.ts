import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  // Reminders live in their own table (task_reminders), not on tasks.
  const service = createServiceClient()
  const { data, error } = await service
    .from('task_reminders')
    .select('*, task:tasks(title, status)')
    .eq('user_id', user.id)
    .lte('remind_at', in24h)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .not('task.status', 'in', '("done","cancelled")')
    .order('remind_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Drop reminders whose task was filtered out by the status check above.
  return NextResponse.json((data ?? []).filter((r) => r.task !== null))
}
