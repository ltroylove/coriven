import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { MemoryPageClient } from './memory-page-client'
import type { Memory } from '@personal-assistant/types'

export default async function MemoryPage() {
  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/signin')

  const [{ data: entities }, { data: memories }] = await Promise.all([
    db.from('entity_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('last_mentioned', { ascending: false, nullsFirst: false }),
    db.from('memories')
      .select('*')
      .eq('user_id', user.id)
      .is('superseded_by', null)
      .order('created_at', { ascending: false }),
  ])

  // The DB returns embedding as string | null (pgvector wire format).
  // The Memory type uses number[] | null (parsed form). We cast here since
  // the memory page only reads content/source/created_at — never embedding.
  return (
    <MemoryPageClient
      entities={entities ?? []}
      memories={(memories ?? []) as unknown as Memory[]}
    />
  )
}
