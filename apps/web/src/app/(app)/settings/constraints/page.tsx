import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { ConstraintsPageClient } from '@/app/(app)/settings/constraints/constraints-page-client'
import type { BehavioralConstraint } from '@personal-assistant/types'

export default async function SettingsConstraintsPage() {
  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/signin')

  const { data } = await db
    .from('behavioral_constraints')
    .select('*')
    .eq('user_id', user.id)
    .order('is_locked', { ascending: false })
    .order('created_at', { ascending: false })

  return <ConstraintsPageClient constraints={(data ?? []) as BehavioralConstraint[]} />
}
