'use client'

import { useState, useTransition } from 'react'
import { updateSentinelMode } from '@/app/actions/profile'

interface SentinelModeClientProps {
  initialMode: 'async' | 'sync'
}

export function SentinelModeClient({ initialMode }: SentinelModeClientProps) {
  const [mode, setMode] = useState<'async' | 'sync'>(initialMode)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleChange(next: 'async' | 'sync') {
    setMode(next)
    setError(null)
    startTransition(async () => {
      const result = await updateSentinelMode(next)
      if (!result.success) {
        setMode(mode) // revert on failure
        setError(result.error ?? 'Failed to save.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-400 mb-2">Context mode</label>

      <button
        type="button"
        onClick={() => handleChange('async')}
        aria-pressed={mode === 'async'}
        disabled={isPending}
        className={[
          'w-full text-left px-4 py-3 rounded-lg border transition-colors',
          mode === 'async'
            ? 'border-emerald-700 bg-emerald-950/40'
            : 'border-gray-800 bg-gray-900/40 hover:border-gray-700',
          isPending ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <p className="text-sm font-medium text-gray-200">Fast <span className="text-xs font-normal text-gray-500 ml-1">(default)</span></p>
        <p className="text-xs text-gray-500 mt-0.5">Responses start immediately. Context may be one message behind.</p>
      </button>

      <button
        type="button"
        onClick={() => handleChange('sync')}
        aria-pressed={mode === 'sync'}
        disabled={isPending}
        className={[
          'w-full text-left px-4 py-3 rounded-lg border transition-colors',
          mode === 'sync'
            ? 'border-emerald-700 bg-emerald-950/40'
            : 'border-gray-800 bg-gray-900/40 hover:border-gray-700',
          isPending ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <p className="text-sm font-medium text-gray-200">Always current</p>
        <p className="text-xs text-gray-500 mt-0.5">Slight delay while context is built. Every response sees the latest.</p>
      </button>

      {error && (
        <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>
      )}
    </div>
  )
}
