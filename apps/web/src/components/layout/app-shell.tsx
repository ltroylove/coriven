'use client'

// FLAGGED BOUNDED EDIT (Wave 9.1.2 task 9.1.2.3.1):
// Mounted ConversationProvider here as the common ancestor of ChatPane, Rail,
// and the history flyout. This is the only change to app-shell.tsx in this wave.

import { ChatPane } from '@/components/chat/chat-pane'
import { Rail } from '@/components/layout/rail'
import { WorkspacePanel } from '@/components/layout/workspace-panel'
import {
  ConversationProvider,
  useActiveConversation,
} from '@/components/providers/conversation-provider'

interface AppShellProps {
  children: React.ReactNode
  userEmail: string
}

/**
 * Inner shell — rendered inside ConversationProvider so Rail and ChatPane both
 * share the same active-conversation store (C1).
 * `key={activeConversationId}` on ChatPane achieves remount-on-switch (Story 9.1.2.3.2 AC).
 */
function AppShellInner({ children, userEmail }: AppShellProps) {
  const { activeConversationId } = useActiveConversation()

  return (
    <div className="flex h-full overflow-hidden">
      {/* ~56px icon rail */}
      <Rail userEmail={userEmail} />

      {/* Chat + workspace panel.
          key= causes React to unmount + remount ChatPane whenever the active
          conversation changes — this resets all state and re-fetches history. */}
      <WorkspacePanel chatPane={<ChatPane key={activeConversationId} />}>
        {children}
      </WorkspacePanel>
    </div>
  )
}

export function AppShell({ children, userEmail }: AppShellProps) {
  return (
    <ConversationProvider>
      <AppShellInner userEmail={userEmail}>{children}</AppShellInner>
    </ConversationProvider>
  )
}
