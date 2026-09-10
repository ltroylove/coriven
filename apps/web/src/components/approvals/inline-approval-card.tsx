'use client'

/**
 * InlineApprovalCard — renders a pending approval directly in the chat stream.
 *
 * ADR-013 §Security / approval-context integrity preserved verbatim:
 * The RAW action payload is the PRIMARY decision surface — preformatted literal
 * text, no markdown, no link rendering. The AI summary is visually secondary
 * and labeled. The user approves what will actually be sent, not a description.
 *
 * On mount for a history-reloaded conversation, fetches current approval status
 * via getApproval(approval_id). If the item is resolved, renders a compact
 * read-only state with no live action buttons.
 */

import { useState, useEffect } from 'react'
import {
  approveAction,
  cancelAction,
  approveWithModifiedPayload,
  getApproval,
} from '@/app/actions/approvals'
import { useTimezone } from '@/components/providers/timezone-provider'
import { formatInTimezone } from '@/lib/utils/timezone'

type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'

type ApprovalData = {
  id: string
  action_type: string
  provider: string
  payload: unknown
  ai_summary: string | null
  status: string
  created_at: string
}

type Mode = 'view' | 'edit'

const STATUS_COLORS: Record<string, string> = {
  approved: 'text-emerald-400',
  cancelled: 'text-gray-500',
  executing: 'text-amber-400',
  executed: 'text-blue-400',
  failed: 'text-red-400',
  pending: 'text-amber-300',
}

const RESOLVED_STATUSES: ApprovalStatus[] = [
  'approved',
  'executing',
  'executed',
  'cancelled',
]

function isResolved(status: string): boolean {
  return RESOLVED_STATUSES.includes(status as ApprovalStatus)
}

// ---------------------------------------------------------------------------
// CompactResolved — read-only view for already-resolved approvals
// ---------------------------------------------------------------------------
function CompactResolved({ data }: { data: ApprovalData }) {
  const timezone = useTimezone()
  const color = STATUS_COLORS[data.status] ?? 'text-gray-400'

  return (
    <div className="my-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">
          {data.action_type}
        </span>
        <span className="text-gray-500">{data.provider}</span>
        <span className={`font-medium ${color}`}>{data.status}</span>
        <span className="ml-auto text-gray-600">
          {formatInTimezone(data.created_at, timezone, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PendingCard — live approve/modify/cancel
// ---------------------------------------------------------------------------
function PendingCard({ data }: { data: ApprovalData }) {
  const [mode, setMode] = useState<Mode>('view')
  const [editedPayload, setEditedPayload] = useState<string>(
    JSON.stringify(data.payload, null, 2),
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [localStatus, setLocalStatus] = useState<string>(data.status)
  const timezone = useTimezone()

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
    setActionPending(true)
    setActionError(null)
    try {
      const result = await approveAction(data.id)
      if (result.error) {
        setActionError(result.error)
      } else {
        setLocalStatus('approved')
      }
    } finally {
      setActionPending(false)
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
    setActionPending(true)
    setActionError(null)
    try {
      const result = await approveWithModifiedPayload(data.id, parsed)
      if (result.error) {
        setActionError(result.error)
      } else {
        setLocalStatus('approved')
        setMode('view')
      }
    } finally {
      setActionPending(false)
    }
  }

  async function handleCancel() {
    setActionPending(true)
    setActionError(null)
    try {
      const result = await cancelAction(data.id)
      if (result.error) {
        setActionError(result.error)
      } else {
        setLocalStatus('cancelled')
      }
    } finally {
      setActionPending(false)
    }
  }

  // After an action resolves, show compact state
  if (isResolved(localStatus)) {
    return (
      <CompactResolved
        data={{ ...data, status: localStatus }}
      />
    )
  }

  return (
    <div className="my-3 rounded-lg border border-amber-800/40 bg-amber-950/10 overflow-hidden">
      {/* Amber identity header — "needs your judgment" */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-800/30 bg-amber-950/20">
        <span className="text-[10px] font-medium uppercase tracking-widest text-amber-500">
          Needs your approval
        </span>
        <span className="text-xs font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded ml-auto">
          {data.action_type}
        </span>
        <span className="text-xs text-gray-500">{data.provider}</span>
        <span className="text-xs text-gray-600">
          {formatInTimezone(data.created_at, timezone, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {/* AI summary — visually secondary, labeled (ADR-013) */}
      {data.ai_summary && (
        <div className="px-4 py-2 bg-gray-900/30 border-b border-amber-800/20">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">
            AI summary (model-generated — review the raw payload below)
          </p>
          <p className="text-xs text-gray-400">{data.ai_summary}</p>
        </div>
      )}

      {/* Raw payload — PRIMARY decision surface (ADR-013 §Security) */}
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-gray-300 mb-2">
          Raw action payload
          <span className="ml-2 text-xs text-amber-500 font-normal">
            (this is what will be sent — approve based on this)
          </span>
        </p>

        {mode === 'view' ? (
          <pre className="text-xs text-gray-200 bg-gray-950 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
            {JSON.stringify(data.payload, null, 2)}
          </pre>
        ) : (
          <div>
            <textarea
              className="w-full text-xs text-gray-200 bg-gray-950 rounded p-3 font-mono leading-relaxed border border-gray-700 focus:border-amber-600 focus:outline-none resize-y min-h-[8rem]"
              value={editedPayload}
              onChange={(e) => handleEditChange(e.target.value)}
              spellCheck={false}
              aria-label="Edit payload"
            />
            {parseError && (
              <p className="text-xs text-red-400 mt-1" role="alert">{parseError}</p>
            )}
          </div>
        )}
      </div>

      {/* Action error */}
      {actionError && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2" role="alert">
            {actionError}
          </p>
        </div>
      )}

      {/* Action buttons — Approve (primary) / Modify / Cancel (destructive) */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-amber-800/30 bg-gray-900/20">
        {mode === 'view' ? (
          <>
            <button
              onClick={handleApprove}
              disabled={actionPending}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => setMode('edit')}
              disabled={actionPending}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Modify
            </button>
            <button
              onClick={handleCancel}
              disabled={actionPending}
              className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-50 ml-auto"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleApproveModified}
              disabled={actionPending || !!parseError}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              Approve with changes
            </button>
            <button
              onClick={() => {
                setMode('view')
                setEditedPayload(JSON.stringify(data.payload, null, 2))
                setParseError(null)
                setActionError(null)
              }}
              disabled={actionPending}
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

// ---------------------------------------------------------------------------
// InlineApprovalCard — top-level component
// Fetches fresh status on mount for history-reloaded conversations.
// ---------------------------------------------------------------------------

type Props = {
  approvalId: string
  /** Initial data from the tool-result content (may be stale for reloaded history) */
  initialData?: Partial<ApprovalData>
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: ApprovalData }

export function InlineApprovalCard({ approvalId, initialData }: Props) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result = await getApproval(approvalId)
      if (cancelled) return

      if ('error' in result) {
        setState({ phase: 'error', message: result.error })
        return
      }

      setState({
        phase: 'ready',
        data: {
          id: result.id,
          action_type: result.action_type,
          provider: result.provider,
          payload: result.payload,
          ai_summary: result.ai_summary,
          status: result.status,
          created_at: result.created_at,
        },
      })
    }

    void load()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId])

  if (state.phase === 'loading') {
    return (
      <div className="my-3 rounded-lg border border-amber-800/30 bg-amber-950/10 px-4 py-3">
        <p className="text-xs text-amber-600 animate-pulse">Loading approval…</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    // Fallback: show minimal info from initialData if available, or plain error
    return (
      <div className="my-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
        <p className="text-xs text-gray-500">
          {initialData?.action_type
            ? `Action: ${initialData.action_type} — `
            : ''}
          {state.message}
        </p>
      </div>
    )
  }

  const { data } = state

  if (isResolved(data.status)) {
    return <CompactResolved data={data} />
  }

  return <PendingCard data={data} />
}
