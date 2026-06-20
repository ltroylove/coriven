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

  const service = createServiceClient()
  const { data, error } = await service
    .from('tasks')
    .select('*')
    .eq('user_id', user.id)
    .not('remind_at', 'is', null)
    .lte('remind_at', in24h)
    .not('status', 'in', '("done","cancelled")')
    .or(`last_fired_at.is.null,last_fired_at.lt.remind_at`)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('remind_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
