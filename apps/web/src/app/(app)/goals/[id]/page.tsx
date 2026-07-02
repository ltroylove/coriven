import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { updateGoalStatusForm, updateGoalConfidenceForm } from '@/app/actions/goals'

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    achieved: 'bg-green-500/20 text-green-400',
    paused: 'bg-yellow-500/20 text-yellow-400',
    abandoned: 'bg-gray-500/20 text-gray-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high: 'bg-green-500/20 text-green-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    low: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[confidence] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {confidence} confidence
    </span>
  )
}

function MomentumBadge({ momentum }: { momentum: string | null }) {
  if (!momentum) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-500">
        calculating
      </span>
    )
  }
  const styles: Record<string, string> = {
    improving: 'bg-green-500/20 text-green-400',
    stable: 'bg-gray-500/20 text-gray-400',
    declining: 'bg-amber-500/20 text-amber-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[momentum] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {momentum}
    </span>
  )
}

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/goals')

  const { data: goal } = await supabase
    .from('goals')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-lg font-semibold text-white mb-2">Goal not found</h1>
        <p className="text-sm text-gray-500 mb-4">This goal does not exist or you don&apos;t have access to it.</p>
        <Link href="/goals" className="text-sm text-blue-500 hover:text-blue-400 transition-colors">
          Back to Goals
        </Link>
      </div>
    )
  }

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority')
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/goals" className="text-xs text-gray-500 hover:text-gray-400 transition-colors mb-3 inline-block">
          ← Goals
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-white">{goal.title}</h1>
          <div className="flex-shrink-0">
            <MomentumBadge momentum={goal.momentum} />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <StatusBadge status={goal.status} />
          <ConfidenceBadge confidence={goal.confidence} />
          {goal.last_activity_at && (
            <span className="text-xs text-gray-500">
              Last activity {new Date(goal.last_activity_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {goal.why_it_matters && (
        <div className="mb-6">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Why it matters</h2>
          <p className="text-sm text-gray-300 leading-relaxed">{goal.why_it_matters}</p>
        </div>
      )}

      {goal.success_metrics && (
        <div className="mb-6">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Success metrics</h2>
          <p className="text-sm text-gray-300 leading-relaxed">{goal.success_metrics}</p>
        </div>
      )}

      {/* Inline status and confidence controls */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <form action={updateGoalStatusForm}>
          <input type="hidden" name="id" value={goal.id} />
          <label htmlFor="goal-status" className="block text-xs font-medium text-gray-400 mb-1">Status</label>
          <select
            id="goal-status"
            name="status"
            defaultValue={goal.status}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Goal status"
          >
            <option value="active">Active</option>
            <option value="achieved">Achieved</option>
            <option value="paused">Paused</option>
            <option value="abandoned">Abandoned</option>
          </select>
          <button
            type="submit"
            className="mt-2 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 rounded-lg transition-colors"
          >
            Update status
          </button>
        </form>

        <form action={updateGoalConfidenceForm}>
          <input type="hidden" name="id" value={goal.id} />
          <label htmlFor="goal-confidence" className="block text-xs font-medium text-gray-400 mb-1">Confidence</label>
          <select
            id="goal-confidence"
            name="confidence"
            defaultValue={goal.confidence}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Goal confidence"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            type="submit"
            className="mt-2 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 rounded-lg transition-colors"
          >
            Update confidence
          </button>
        </form>
      </div>

      {/* Linked Projects */}
      <div className="mb-6">
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
          Projects ({(projects ?? []).length})
        </h2>
        {(projects ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No projects linked — add one via chat.</p>
        ) : (
          <div className="space-y-2">
            {(projects ?? []).map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-800 bg-gray-900 hover:border-gray-700 transition-colors"
              >
                <span className="text-sm text-white">{project.title}</span>
                <span className="text-xs text-gray-500">{project.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Linked Tasks */}
      <div>
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
          Tasks ({(tasks ?? []).length})
        </h2>
        {(tasks ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No tasks linked — add one via chat or the Tasks page.</p>
        ) : (
          <div className="space-y-2">
            {(tasks ?? []).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-800 bg-gray-900"
              >
                <span className="text-sm text-white">{task.title}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{task.priority}</span>
                  <span className="text-xs text-gray-500">{task.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
