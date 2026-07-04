'use client'

/**
 * FollowUpRow — single row in the "Waiting on replies" section.
 *
 * Plain text rendering throughout — no dangerouslySetInnerHTML.
 * Dismiss button calls the dismissFollowUp server action.
 */

import { useState } from 'react'
import { dismissFollowUp } from '@/app/actions/email'
import type { Database } from '@/types/supabase'

export type FollowUpCandidate =
  Database['public']['Tables']['followup_candidates']['Row']

interface FollowUpRowProps {
  candidate: FollowUpCandidate
}

function daysSince(isoString: string): number {
  const sentMs = new Date(isoString).getTime()
  const nowMs = Date.now()
  return Math.floor((nowMs - sentMs) / (1000 * 60 * 60 * 24))
}

export function FollowUpRow({ candidate }: FollowUpRowProps) {
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)

  if (dismissed) return null

  const days = daysSince(candidate.last_sent_at)
  const daysLabel = days === 1 ? '1 day' : `${days} days`
  const toDisplay = candidate.to_address ?? 'Unknown recipient'
  const subjectDisplay = candidate.subject ?? '(no subject)'

  async function handleDismiss() {
    setLoading(true)
    const result = await dismissFollowUp(candidate.id)
    if (result.success) {
      setDismissed(true)
    } else {
      // Re-enable button on failure so user can retry
      setLoading(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3 px-4 rounded-lg bg-gray-900 border border-gray-800">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate" title={toDisplay}>
          {toDisplay}
        </p>
        <p className="text-sm text-gray-400 truncate mt-0.5" title={subjectDisplay}>
          {subjectDisplay}
        </p>
        <p className="text-xs text-amber-500 mt-1">
          Waiting {daysLabel} — no reply yet
        </p>
      </div>

      <button
        onClick={handleDismiss}
        disabled={loading}
        aria-label={`Dismiss follow-up for: ${subjectDisplay}`}
        className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded border border-gray-800 hover:border-gray-700"
      >
        {loading ? 'Dismissing...' : 'Dismiss'}
      </button>
    </div>
  )
}
