import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { ApprovalCard } from './approval-card'

export default async function ApprovalsPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/approvals')

  const { data: allItems } = await supabase
    .from('approval_queue')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const pending = (allItems ?? []).filter((item) => item.status === 'pending')
  const history = (allItems ?? []).filter((item) => item.status !== 'pending')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review proposed external actions before anything changes in the outside world
        </p>
      </div>

      {/* Pending section */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-300 mb-3">
          Pending{' '}
          {pending.length > 0 && (
            <span className="ml-1 text-xs bg-amber-900/50 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded-full">
              {pending.length}
            </span>
          )}
        </h2>

        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center">
            <p className="text-sm text-gray-500">No pending approvals</p>
            <p className="text-xs text-gray-600 mt-1">
              When the assistant proposes an external action, it will appear here for your review
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((item) => (
              <ApprovalCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* History section */}
      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3">History</h2>
          <div className="space-y-3">
            {history.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// History row — read-only summary for terminal-state items
// ---------------------------------------------------------------------------

function HistoryRow({
  item,
}: {
  item: {
    id: string
    action_type: string
    provider: string
    status: string
    created_at: string
    reviewed_at: string | null
    payload: unknown
  }
}) {
  const statusColors: Record<string, string> = {
    approved: 'text-emerald-400',
    cancelled: 'text-gray-500',
    executed: 'text-blue-400',
    failed: 'text-red-400',
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">
            {item.action_type}
          </span>
          <span className="text-xs text-gray-500">{item.provider}</span>
          <span className={`text-xs font-medium ${statusColors[item.status] ?? 'text-gray-400'}`}>
            {item.status}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Created {new Date(item.created_at).toLocaleString()}
          {item.reviewed_at && ` · Reviewed ${new Date(item.reviewed_at).toLocaleString()}`}
        </p>
      </div>
    </div>
  )
}
