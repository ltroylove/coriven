'use client'

import { Plus, MessageSquare } from 'lucide-react'
import type { Conversation } from './types'

function groupByDay(conversations: Conversation[]) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const groups: { label: string; items: Conversation[] }[] = []
  const buckets = new Map<string, Conversation[]>()

  for (const c of conversations) {
    const d = new Date(c.updated_at)
    let label: string
    if (d.toDateString() === today.toDateString()) label = 'Today'
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday'
    else label = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(c)
  }

  for (const [label, items] of buckets) {
    groups.push({ label, items })
  }
  return groups
}

type Props = {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationList({ conversations, activeId, onSelect, onNew }: Props) {
  const groups = groupByDay(conversations)

  return (
    <div className="w-56 shrink-0 flex flex-col border-r border-gray-800 bg-gray-950 overflow-hidden">
      <div className="shrink-0 px-3 py-3 border-b border-gray-800/60">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors border border-gray-800 hover:border-gray-700"
        >
          <Plus className="w-3.5 h-3.5" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {groups.length === 0 && (
          <p className="text-xs text-gray-700 text-center py-8 px-3">No conversations yet</p>
        )}
        {groups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] uppercase tracking-widest text-gray-700 font-medium px-2 mb-1">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors group ${
                    activeId === conv.id
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
                  }`}
                >
                  <MessageSquare className={`w-3 h-3 shrink-0 ${activeId === conv.id ? 'text-emerald-400' : 'text-gray-700 group-hover:text-gray-500'}`} />
                  <span className="text-xs truncate">{conv.title || 'Untitled'}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
