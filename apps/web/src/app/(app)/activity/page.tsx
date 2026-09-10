import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { ApprovalCard } from '@/components/approvals/approval-card'
import { HistoryRow } from '@/components/approvals/history-row'

/**
 * /activity — audit-first approval history page.
 *
 * Presents the full approval_queue audit trail: history rows (with failure
 * reasons, retry affordance, and timezone-correct timestamps) at the top,
 * plus a pending fallback section for any still-pending items.
 *
 * Per C5: no rail icon; reachable by URL and registered as the 'activity'
 * surface (see registry.ts). /approvals permanently redirects here.
 *
 * Primary pending surface = inline card in chat (C7). This page is the
 * aggregate audit/history view and a fallback for pending items until the
 * 9.2.3 attention card arrives.
 */
export default async function ActivityPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

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
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Audit trail of proposed external actions — approved, executed, failed, canceled
        </p>
      </div>

      {/* History section — audit-first */}
      {history.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-medium text-gray-400 mb-3">History</h2>
          <div className="space-y-3">
            {history.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Pending fallback section */}
      <section>
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
              Pending approval cards appear inline in chat where you asked. They also appear here as a fallback.
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

      {history.length === 0 && pending.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center mt-4">
          <p className="text-sm text-gray-500">No activity yet</p>
          <p className="text-xs text-gray-600 mt-1">
            When the assistant proposes an external action (like sending an email), it will appear here.
          </p>
        </div>
      )}
    </div>
  )
}
