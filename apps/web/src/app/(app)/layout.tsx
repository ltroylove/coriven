import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { TimezoneProvider } from '@/components/providers/timezone-provider'
import { PanelProvider } from '@/components/providers/panel-provider'
import { AppShell } from '@/components/layout/app-shell'

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
    <TimezoneProvider timezone={timezone}>
      <PanelProvider>
        <div className="h-screen flex bg-gray-950 text-white overflow-hidden">
          <AppShell userEmail={user.email ?? ''}>
            <div className="h-full overflow-auto p-6">{children}</div>
          </AppShell>
        </div>
      </PanelProvider>
    </TimezoneProvider>
  )
}
