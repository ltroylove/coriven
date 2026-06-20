'use client'

import { useState, useEffect } from 'react'
import { ConversationList } from '@/components/chat/conversation-list'
import { ChatPane } from '@/components/chat/chat-pane'
import type { Conversation } from '@/components/chat/types'

const CHAT_ACTIVE_KEY = 'chat-tab-active-id'

function makeConversation(title = 'New conversation', id?: string): Conversation {
  return {
    id: id ?? crypto.randomUUID(),
    title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function getOrCreateActiveId(): string {
  const stored = localStorage.getItem(CHAT_ACTIVE_KEY)
  if (stored) return stored
  const id = crypto.randomUUID()
  localStorage.setItem(CHAT_ACTIVE_KEY, id)
  return id
}

export function ChatClient() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])

  // Initialise from localStorage on mount (avoids hydration mismatch)
  useEffect(() => {
    const id = getOrCreateActiveId()
    setActiveId(id)
    setConversations([makeConversation('New conversation', id)])
  }, [])

  const activeConv = conversations.find(c => c.id === activeId)

  function handleNew() {
    const conv = makeConversation()
    localStorage.setItem(CHAT_ACTIVE_KEY, conv.id)
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
  }

  function handleSelect(id: string) {
    localStorage.setItem(CHAT_ACTIVE_KEY, id)
    setActiveId(id)
  }

  function handleFirstMessage(text: string) {
    const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
    setConversations(prev =>
      prev.map(c => (c.id === activeId ? { ...c, title, updated_at: new Date().toISOString() } : c)),
    )
  }

  if (!activeId) return null

  return (
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
  )
}
