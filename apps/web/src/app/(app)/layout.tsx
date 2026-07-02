import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { signOut } from '@/app/(auth)/signin/actions'
import { ResizablePanels } from '@/components/layout/resizable-panels'
import { ChatPane } from '@/components/chat/chat-pane'
import { AppNav } from '@/components/layout/app-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/signin')

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <nav className="shrink-0 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-white">Coriven</span>
          <AppNav />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{user.email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <ResizablePanels rightPanel={<ChatPane />}>
        <div className="h-full overflow-auto p-6">{children}</div>
      </ResizablePanels>
    </div>
  )
}
