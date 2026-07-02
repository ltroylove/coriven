import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { updateProjectStatusForm } from '@/app/actions/goals'

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-500/20 text-gray-400',
    in_progress: 'bg-blue-500/20 text-blue-400',
    done: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {labels[status] ?? status}
    </span>
  )
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/goals')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!project) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-lg font-semibold text-white mb-2">Project not found</h1>
        <p className="text-sm text-gray-500 mb-4">This project does not exist or you don&apos;t have access to it.</p>
        <Link href="/goals" className="text-sm text-blue-500 hover:text-blue-400 transition-colors">
          Back to Goals
        </Link>
      </div>
    )
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority')
    .eq('project_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  // Optionally fetch parent goal title for the link
  let parentGoal: { id: string; title: string } | null = null
  if (project.goal_id) {
    const { data: goalData } = await supabase
      .from('goals')
      .select('id, title')
      .eq('id', project.goal_id)
      .eq('user_id', user.id)
      .single()
    parentGoal = goalData ?? null
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        {parentGoal ? (
          <Link href={`/goals/${parentGoal.id}`} className="text-xs text-gray-500 hover:text-gray-400 transition-colors mb-3 inline-block">
            ← {parentGoal.title}
          </Link>
        ) : (
          <Link href="/goals" className="text-xs text-gray-500 hover:text-gray-400 transition-colors mb-3 inline-block">
            ← Goals
          </Link>
        )}

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-white">{project.title}</h1>
          <div className="flex-shrink-0">
            <StatusBadge status={project.status} />
          </div>
        </div>

        {parentGoal && (
          <p className="text-xs text-gray-500 mt-1">
            Part of goal:{' '}
            <Link href={`/goals/${parentGoal.id}`} className="text-blue-500 hover:text-blue-400 transition-colors">
              {parentGoal.title}
            </Link>
          </p>
        )}
      </div>

      {project.description && (
        <div className="mb-6">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Description</h2>
          <p className="text-sm text-gray-300 leading-relaxed">{project.description}</p>
        </div>
      )}

      {/* Status control */}
      <div className="mb-6 max-w-xs">
        <form action={updateProjectStatusForm}>
          <input type="hidden" name="id" value={project.id} />
          <label htmlFor="project-status" className="block text-xs font-medium text-gray-400 mb-1">Status</label>
          <select
            id="project-status"
            name="status"
            defaultValue={project.status}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Project status"
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            type="submit"
            className="mt-2 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 rounded-lg transition-colors"
          >
            Update status
          </button>
        </form>
      </div>

      {/* Linked Tasks */}
      <div>
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
          Tasks ({(tasks ?? []).length})
        </h2>
        {(tasks ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No tasks yet — add one via chat or the Tasks page.</p>
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
