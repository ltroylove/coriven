'use client'

import { useState } from 'react'
import type { EntityProfile } from '@personal-assistant/types'

const TYPE_COLORS: Record<string, string> = {
  person: 'bg-blue-900 text-blue-200',
  place: 'bg-green-900 text-green-200',
  project: 'bg-purple-900 text-purple-200',
  thing: 'bg-yellow-900 text-yellow-200',
  resource: 'bg-orange-900 text-orange-200',
}

interface Props {
  entity: EntityProfile
  onEdit: (id: string, updates: { name: string; description?: string; aliases?: string[] }) => Promise<{ error?: string } | void>
  onDelete: (id: string) => Promise<{ error?: string } | void>
}

export function MemoryEntityRow({ entity, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entity.name)
  const [description, setDescription] = useState(entity.description ?? '')
  const [aliasInput, setAliasInput] = useState(entity.aliases.join(', '))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    const aliases = aliasInput.split(',').map(a => a.trim()).filter(Boolean)
    const result = await onEdit(entity.id, { name: name.trim(), description: description || undefined, aliases })
    setSaving(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
    } else {
      setEditing(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${entity.name}"? This cannot be undone.`)) return
    const result = await onDelete(entity.id)
    if (result && 'error' in result && result.error) setError(result.error)
  }

  const colorClass = TYPE_COLORS[entity.type] ?? 'bg-gray-800 text-gray-300'

  return (
    <li role="article" aria-label={`Entity: ${entity.name}`} className="p-4 bg-gray-800/50 rounded border border-gray-700">
      {editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={`name-${entity.id}`} className="text-xs text-gray-400 block mb-1">Name</label>
            <input
              id={`name-${entity.id}`}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor={`desc-${entity.id}`} className="text-xs text-gray-400 block mb-1">Description</label>
            <input
              id={`desc-${entity.id}`}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor={`aliases-${entity.id}`} className="text-xs text-gray-400 block mb-1">Aliases (comma-separated)</label>
            <input
              id={`aliases-${entity.id}`}
              value={aliasInput}
              onChange={e => setAliasInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-xs text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setError(null) }}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-white">{entity.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${colorClass}`}>{entity.type}</span>
              </div>
              {entity.description && <p className="text-sm text-gray-300 mt-1">{entity.description}</p>}
              {entity.aliases.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2" aria-label="Aliases">
                  {entity.aliases.map(a => (
                    <span key={a} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{a}</span>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Mentions: {entity.mention_count}
                {entity.last_mentioned && (
                  <span className="ml-3">Last: {new Date(entity.last_mentioned).toLocaleDateString()}</span>
                )}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setEditing(true)}
                aria-label={`Edit ${entity.name}`}
                className="text-xs text-gray-400 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded px-2 py-1"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                aria-label={`Delete ${entity.name}`}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-2 py-1"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
