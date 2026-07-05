import { NextResponse } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createApiServerClient(request)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { minutes } = await request.json() as { minutes: number }
  if (!minutes || minutes < 1) {
    return NextResponse.json({ error: 'minutes must be a positive number' }, { status: 400 })
  }

  const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  const service = createServiceClient()
  const { data, error } = await service
    .from('task_reminders')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
