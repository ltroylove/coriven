import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { ApprovalCard } from './approval-card'
import { HistoryRow } from './history-row'

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
