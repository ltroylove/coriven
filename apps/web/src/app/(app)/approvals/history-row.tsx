'use client'

/**
 * HistoryRow — read-only summary of a terminal-state approval item.
 *
 * Displays:
 *   - executed: status label + execution time
 *   - failed: status label + error code + Retry button
 *   - cancelled/approved: status label only
 *
 * The Retry button is only shown for 'failed' items (ADR-013 §Approval flow).
 */

import { useState } from 'react'
import { retryAction } from '@/app/actions/approvals'

const STATUS_COLORS: Record<string, string> = {
  approved: 'text-emerald-400',
  cancelled: 'text-gray-500',
  executing: 'text-amber-400',  // in-progress — non-terminal, no action buttons
  executed: 'text-blue-400',
  failed: 'text-red-400',
}

const ERROR_CODE_LABELS: Record<string, string> = {
  invalid_state: 'Invalid state — item was not eligible for execution',
  unknown_provider: 'Unknown provider — no executor available',
  token_unavailable: 'Provider not connected or token revoked',
  provider_rejected: 'Provider rejected the request',
  network_error: 'Network error — provider unreachable',
  executor_error: 'Internal error during execution',
}

export function HistoryRow({
  item,
}: {
  item: {
    id: string
    action_type: string
    provider: string
    status: string
    created_at: string
    reviewed_at: string | null
    executed_at: string | null
    error_code: string | null
    payload: unknown
  }
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  async function handleRetry() {
    setRetrying(true)
    setRetryError(null)
    try {
      const result = await retryAction(item.id)
      if (result.error) setRetryError(result.error)
    } finally {
      setRetrying(false)
    }
  }

  const errorLabel =
    item.error_code
      ? (ERROR_CODE_LABELS[item.error_code] ?? item.error_code)
      : null

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">
              {item.action_type}
            </span>
            <span className="text-xs text-gray-500">{item.provider}</span>
            <span className={`text-xs font-medium ${STATUS_COLORS[item.status] ?? 'text-gray-400'}`}>
              {item.status}
            </span>
          </div>

          <p className="text-xs text-gray-600 mt-1">
            Created {new Date(item.created_at).toLocaleString()}
            {item.reviewed_at && ` · Reviewed ${new Date(item.reviewed_at).toLocaleString()}`}
            {item.executed_at && ` · Executed ${new Date(item.executed_at).toLocaleString()}`}
          </p>

          {/* Failure reason */}
          {item.status === 'failed' && errorLabel && (
            <p className="text-xs text-red-400 mt-1.5 bg-red-950/30 border border-red-800/40 rounded px-2 py-1">
              {errorLabel}
            </p>
          )}

          {/* Retry error feedback */}
          {retryError && (
            <p className="text-xs text-red-400 mt-1">
              Retry failed: {retryError}
            </p>
          )}
        </div>

        {/* Executing indicator — in-progress, no action buttons available */}
        {item.status === 'executing' && (
          <span className="shrink-0 text-xs px-3 py-1.5 rounded border border-amber-700/50 text-amber-400 opacity-70">
            Executing…
          </span>
        )}

        {/* Retry button — only for failed items (not for executing — non-terminal) */}
        {item.status === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0 text-xs px-3 py-1.5 rounded border border-amber-700/50 text-amber-400 hover:bg-amber-900/30 hover:border-amber-600 transition-colors disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    </div>
  )
}
