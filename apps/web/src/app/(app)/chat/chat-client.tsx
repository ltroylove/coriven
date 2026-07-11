'use client'

// NOTE(9.1.2): Legacy localStorage conversation keys (CHAT_ACTIVE_KEY /
// 'chat-tab-active-id') removed. The /chat route is deleted in Wave 9.1.3.
// This file is retained only to keep the route non-broken until 9.1.3 arrives.

import { useState } from 'react'
import { ConversationList } from '@/components/chat/conversation-list'
import { ChatPane } from '@/components/chat/chat-pane'
import { ConversationProvider } from '@/components/providers/conversation-provider'
import type { Conversation } from '@/components/chat/types'

function makeConversation(title = 'New conversation', id?: string): Conversation {
  return {
    id: id ?? crypto.randomUUID(),
    title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export function ChatClient() {
  const [activeId, setActiveId] = useState<string>(() => crypto.randomUUID())
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    makeConversation('New conversation', activeId),
  ])

  const activeConv = conversations.find(c => c.id === activeId)

  function handleNew() {
    const conv = makeConversation()
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
  }

  function handleSelect(id: string) {
    setActiveId(id)
  }

  function handleFirstMessage(text: string) {
    const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
    setConversations(prev =>
      prev.map(c => (c.id === activeId ? { ...c, title, updated_at: new Date().toISOString() } : c)),
    )
  }

  return (
    <ConversationProvider>
      <div className="flex h-full w-full">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-gray-800/60">
            <h2 className="text-sm font-medium text-gray-300 truncate">
              {activeConv?.title ?? 'New conversation'}
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-gray-600 uppercase tracking-widest">claude</span>
            </div>
          </div>
          <ChatPane key={activeId} conversationId={activeId} onFirstMessage={handleFirstMessage} />
        </div>
      </div>
    </ConversationProvider>
  )
}
