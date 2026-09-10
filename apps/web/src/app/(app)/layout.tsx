// FLAGGED BOUNDED EDIT (Wave 9.1.3 task 9.1.3.1.1):
// Replaced inline provider stack with the shared AuthedShell composition so that
// the root page.tsx (outside this route group) can use the same stack without
// duplication. Behavior is identical; no providers added or removed.

import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { AuthedShell } from '@/components/layout/authed-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/signin')

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single()

  const timezone = profile?.timezone ?? 'America/Chicago'

  return (
    <AuthedShell userEmail={user.email ?? ''} timezone={timezone}>
      {children}
    </AuthedShell>
  )
}
