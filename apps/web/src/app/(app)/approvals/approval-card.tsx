'use client'

/**
 * ApprovalCard — displays a pending approval item.
 *
 * Security requirement (ADR-013 §Security / approval-context integrity):
 * The RAW action payload is the primary decision surface — exact recipient,
 * subject, full body, URLs — rendered as literal preformatted text.
 * The ai_summary MAY be shown alongside but is clearly labeled as AI-generated
 * and is visually secondary. The user approves what will actually be sent,
 * not a model-generated description of it.
 *
 * No markdown rendering, no link anchors on payload content.
 */

import { useState } from 'react'
import { approveAction, cancelAction, approveWithModifiedPayload } from '@/app/actions/approvals'

type Mode = 'view' | 'edit'

export function ApprovalCard({
  item,
}: {
  item: {
    id: string
    action_type: string
    provider: string
    payload: unknown
    ai_summary: string | null
    status: string
    created_at: string
  }
}) {
  const [mode, setMode] = useState<Mode>('view')
  const [editedPayload, setEditedPayload] = useState<string>(
    JSON.stringify(item.payload, null, 2),
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function handleEditChange(value: string) {
    setEditedPayload(value)
    setParseError(null)
    try {
      JSON.parse(value)
    } catch {
      setParseError('Payload must be valid JSON')
    }
  }

  async function handleApprove() {
    setPending(true)
    setActionError(null)
    try {
      const result = await approveAction(item.id)
      if (result.error) setActionError(result.error)
    } finally {
      setPending(false)
    }
  }

  async function handleApproveModified() {
    if (parseError) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(editedPayload) as Record<string, unknown>
    } catch {
      setParseError('Payload must be valid JSON')
      return
    }
    setPending(true)
    setActionError(null)
    try {
      const result = await approveWithModifiedPayload(item.id, parsed)
      if (result.error) {
        setActionError(result.error)
      } else {
        setMode('view')
      }
    } finally {
      setPending(false)
    }
  }

  async function handleCancel() {
    setPending(true)
    setActionError(null)
    try {
      const result = await cancelAction(item.id)
      if (result.error) setActionError(result.error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-800/40 bg-gray-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <span className="text-xs font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">
          {item.action_type}
        </span>
        <span className="text-xs text-gray-500">{item.provider}</span>
        <span className="ml-auto text-xs text-gray-600">
          {new Date(item.created_at).toLocaleString()}
        </span>
      </div>

      {/* AI summary — visually secondary, labeled */}
      {item.ai_summary && (
        <div className="px-4 py-2 bg-gray-900/40 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            AI summary (model-generated — review the raw payload below)
          </p>
          <p className="text-sm text-gray-400">{item.ai_summary}</p>
        </div>
      )}

      {/* Raw payload — primary decision surface (ADR-013 §Security) */}
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-gray-300 mb-2">
          Raw action payload
          <span className="ml-2 text-xs text-amber-500 font-normal">
            (this is what will be sent — approve based on this)
          </span>
        </p>

        {mode === 'view' ? (
          <pre className="text-xs text-gray-200 bg-gray-950 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
            {JSON.stringify(item.payload, null, 2)}
          </pre>
        ) : (
          <div>
            <textarea
              className="w-full text-xs text-gray-200 bg-gray-950 rounded p-3 font-mono leading-relaxed border border-gray-700 focus:border-amber-600 focus:outline-none resize-y min-h-32"
              value={editedPayload}
              onChange={(e) => handleEditChange(e.target.value)}
              spellCheck={false}
              aria-label="Edit payload"
            />
            {parseError && (
              <p className="text-xs text-red-400 mt-1">{parseError}</p>
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {actionError && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
            {actionError}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 bg-gray-900/30">
        {mode === 'view' ? (
          <>
            <button
              onClick={handleApprove}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => setMode('edit')}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Modify
            </button>
            <button
              onClick={handleCancel}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-50 ml-auto"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleApproveModified}
              disabled={pending || !!parseError}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              Approve with changes
            </button>
            <button
              onClick={() => {
                setMode('view')
                setEditedPayload(JSON.stringify(item.payload, null, 2))
                setParseError(null)
                setActionError(null)
              }}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              Discard changes
            </button>
          </>
        )}
      </div>
    </div>
  )
}
