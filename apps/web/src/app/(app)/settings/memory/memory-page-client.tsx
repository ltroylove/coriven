'use client'

import { useState, useMemo } from 'react'
import type { EntityProfile, Memory } from '@personal-assistant/types'
import { MemoryEntityRow } from '@/components/memory/memory-entity-row'
import { deleteMemory, editEntity, deleteEntity } from '@/app/actions/memory'

interface Props {
  entities: EntityProfile[]
  memories: Memory[]
}

export function MemoryPageClient({ entities, memories }: Props) {
  const [activeTab, setActiveTab] = useState<'entities' | 'memories'>('entities')
  const [search, setSearch] = useState('')
  const [localMemories, setLocalMemories] = useState(memories)
  const [error, setError] = useState<string | null>(null)

  const filteredMemories = useMemo(
    () => localMemories.filter(m => m.content.toLowerCase().includes(search.toLowerCase())),
    [localMemories, search]
  )

  async function handleDeleteMemory(id: string) {
    if (!confirm('Delete this memory?')) return
    setLocalMemories(prev => prev.filter(m => m.id !== id))
    const result = await deleteMemory(id)
    if (result?.error) {
      setError(result.error)
      setLocalMemories(memories) // revert
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Memory</h1>
      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Memory sections" className="flex gap-1 mb-6 border-b border-gray-800">
        {(['entities', 'memories'] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500 -mb-px'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'entities' ? `Entities (${entities.length})` : `Memories (${localMemories.length})`}
          </button>
        ))}
      </div>

      {/* Entities panel */}
      <div
        role="tabpanel"
        id="panel-entities"
        aria-labelledby="tab-entities"
        hidden={activeTab !== 'entities'}
      >
        {entities.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">
            I haven&apos;t learned about any people, places, or projects yet. Tell me about them in chat.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Entity profiles">
            {entities.map(entity => (
              <MemoryEntityRow
                key={entity.id}
                entity={entity}
                onEdit={editEntity}
                onDelete={deleteEntity}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Memories panel */}
      <div
        role="tabpanel"
        id="panel-memories"
        aria-labelledby="tab-memories"
        hidden={activeTab !== 'memories'}
      >
        <div className="mb-4">
          <label htmlFor="memory-search" className="sr-only">Search memories</label>
          <input
            id="memory-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {filteredMemories.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">
            {search ? 'No memories match your search.' : 'No memories saved yet. Chat with Coriven to build up your memory.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Saved memories">
            {filteredMemories.map(m => (
              <li
                key={m.id}
                role="article"
                className="flex items-start justify-between gap-3 p-3 bg-gray-800/50 rounded border border-gray-700"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">{m.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {m.source && <span className="mr-2">Source: {m.source}</span>}
                    {new Date(m.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteMemory(m.id)}
                  aria-label={`Delete memory: ${m.content.slice(0, 30)}`}
                  className="shrink-0 text-xs text-gray-500 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-2 py-1"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
