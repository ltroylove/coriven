'use client'

import { useState } from 'react'
import type { BehavioralConstraint } from '@personal-assistant/types'

interface Props {
  constraint: BehavioralConstraint
  onRemove: (id: string) => Promise<{ error?: string }>
  onLock: (id: string) => Promise<{ error?: string }>
}

export function ConstraintRow({ constraint, onRemove, onLock }: Props) {
  const [removing, setRemoving] = useState(false)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove() {
    if (!confirm('Remove this constraint? This cannot be undone.')) return
    setRemoving(true)
    setError(null)
    const result = await onRemove(constraint.id)
    if (result.error) setError(result.error)
    setRemoving(false)
  }

  async function handleLock() {
    if (!confirm('Lock this constraint? Locked constraints cannot be unlocked from the UI — you would need to remove and re-add it to change it.')) return
    setLocking(true)
    setError(null)
    const result = await onLock(constraint.id)
    if (result.error) setError(result.error)
    setLocking(false)
  }

  return (
    <li className="bg-gray-800/50 rounded border border-gray-700 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{constraint.rule}</span>
            {constraint.is_locked && (
              <span
                className="px-1.5 py-0.5 rounded text-xs bg-red-900 text-red-200"
                aria-label="Locked constraint"
              >
                Locked
              </span>
            )}
            {constraint.scope !== 'all' && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-blue-900 text-blue-200">
                {constraint.scope}
              </span>
            )}
            {constraint.scope === 'all' && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
                global
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            <span className="text-gray-500">Why: </span>{constraint.rationale}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!constraint.is_locked && (
            <button
              onClick={handleLock}
              disabled={locking}
              className="text-xs text-gray-400 hover:text-yellow-400 transition-colors disabled:opacity-50"
              aria-label="Lock this constraint"
            >
              {locking ? 'Locking…' : 'Lock'}
            </button>
          )}
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
            aria-label="Remove this constraint"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400" role="alert">{error}</p>
      )}

      {constraint.is_locked && (
        <p className="text-xs text-gray-600">
          Locked — remove and re-add to change this rule.
        </p>
      )}
    </li>
  )
}
