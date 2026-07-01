'use client'

import { useState } from 'react'

interface Props {
  onAdded: () => void
  onAdd: (formData: FormData) => Promise<{ error?: string }>
}

export function ConstraintForm({ onAdded, onAdd }: Props) {
  const [rule, setRule] = useState('')
  const [rationale, setRationale] = useState('')
  const [scope, setScope] = useState('')
  const [isLocked, setIsLocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rationaleError, setRationaleError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRationaleError(null)
    setError(null)

    if (!rationale.trim()) {
      setRationaleError('Rationale is required.')
      return
    }

    const fd = new FormData()
    fd.set('rule', rule)
    fd.set('rationale', rationale)
    fd.set('scope', scope.trim() || 'all')
    fd.set('is_locked', String(isLocked))

    setSubmitting(true)
    const result = await onAdd(fd)
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setRule('')
    setRationale('')
    setScope('')
    setIsLocked(false)
    onAdded()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800/50 rounded border border-gray-700 p-4 space-y-3">
      <h2 className="text-sm font-medium text-white">Add constraint</h2>

      <div className="space-y-1">
        <label htmlFor="rule" className="text-xs text-gray-400">
          Rule <span className="text-red-400" aria-label="required">*</span>
        </label>
        <input
          id="rule"
          type="text"
          value={rule}
          onChange={e => setRule(e.target.value)}
          placeholder='e.g. "never modify MealPrepForge code"'
          required
          aria-required="true"
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="rationale" className="text-xs text-gray-400">
          Rationale <span className="text-red-400" aria-label="required">*</span>
          <span className="text-gray-600 ml-1">— explain why this rule exists; helps Coriven understand it more deeply</span>
        </label>
        <textarea
          id="rationale"
          value={rationale}
          onChange={e => { setRationale(e.target.value); setRationaleError(null) }}
          placeholder='e.g. "MealPrepForge is a separate business — changes there must not happen through Coriven"'
          required
          aria-required="true"
          aria-describedby={rationaleError ? 'rationale-error' : undefined}
          rows={2}
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        {rationaleError && (
          <p id="rationale-error" className="text-xs text-red-400" role="alert">{rationaleError}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="scope" className="text-xs text-gray-400">
          Scope <span className="text-gray-600">— optional tag (e.g. "MealPrepForge"). Leave blank for global.</span>
        </label>
        <input
          id="scope"
          type="text"
          value={scope}
          onChange={e => setScope(e.target.value)}
          placeholder="all (default)"
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is_locked"
          type="checkbox"
          checked={isLocked}
          onChange={e => setIsLocked(e.target.checked)}
          className="rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
        />
        <label htmlFor="is_locked" className="text-xs text-gray-400">
          Lock this constraint <span className="text-gray-600">— locked rules are hard stops; cannot be unlocked from the UI</span>
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-400" role="alert">{error}</p>
      )}

      <div aria-live="polite" className="sr-only" />

      <button
        type="submit"
        disabled={submitting || !rule.trim()}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {submitting ? 'Saving…' : 'Save constraint'}
      </button>
    </form>
  )
}
