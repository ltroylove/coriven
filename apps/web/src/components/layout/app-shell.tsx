'use client'

import { useState } from 'react'
import { ChatPane } from '@/components/chat/chat-pane'
import { Rail } from '@/components/layout/rail'
import { WorkspacePanel } from '@/components/layout/workspace-panel'

interface AppShellProps {
  children: React.ReactNode
  userEmail: string
}

export function AppShell({ children, userEmail }: AppShellProps) {
  // chatKey increments when the user clicks "New chat" in the rail.
  // Changing the key causes React to unmount + remount ChatPane, starting a
  // fresh conversation. Outside of that, ChatPane is rendered ABOVE/OUTSIDE
  // the WorkspacePanel children so it is NEVER remounted on navigation.
  // TODO(9.1.2): remove chatKey and the onNewChat/handleNewChat indirection;
  //              new-chat will be handled by the unified conversation store (C1).
  const [chatKey, setChatKey] = useState(0)

  function handleNewChat() {
    setChatKey((k) => k + 1)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ~56px icon rail */}
      <Rail userEmail={userEmail} onNewChat={handleNewChat} />

      {/* Chat + workspace panel */}
      <WorkspacePanel chatPane={<ChatPane key={chatKey} />}>
        {children}
      </WorkspacePanel>
    </div>
  )
}
