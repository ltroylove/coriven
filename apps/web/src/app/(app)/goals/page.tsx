import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { GoalCard } from '@/components/goals/goal-card'

export default async function GoalsPage() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/goals')

  const { data: lifeAreas } = await supabase
    .from('life_areas')
    .select('*, goals(*, projects(count))')
    .eq('user_id', user.id)
    .order('sort_order')

  // Fetch goals with no life_area_id for the "Uncategorized" column
  const { data: allGoals } = await supabase
    .from('goals')
    .select('*, projects(count)')
    .eq('user_id', user.id)

  const uncategorizedGoals = (allGoals ?? []).filter(g => g.life_area_id === null)

  // Fetch task counts per goal
  const { data: taskRows } = await supabase
    .from('tasks')
    .select('goal_id')
    .eq('user_id', user.id)
    .not('goal_id', 'is', null)

  const taskCountByGoalId = (taskRows ?? []).reduce<Record<string, number>>((acc, row) => {
    if (row.goal_id) {
      acc[row.goal_id] = (acc[row.goal_id] ?? 0) + 1
    }
    return acc
  }, {})

  const areas = lifeAreas ?? []

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Goals</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your life areas and goals at a glance</p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {areas.map((area) => {
          const goals = (area.goals as Array<{
            id: string
            title: string
            why_it_matters: string | null
            momentum: 'improving' | 'stable' | 'declining' | null
            life_area_id: string | null
            projects: Array<{ count: number }>
          }>) ?? []

          return (
            <div key={area.id} className="flex-shrink-0 w-72">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-gray-300">{area.name}</h2>
                <span className="text-xs text-gray-600">{goals.length}</span>
              </div>

              {goals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center">
                  <p className="text-xs text-gray-600 mb-2">No goals yet</p>
                  <Link
                    href="/"
                    className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                  >
                    Add a goal via chat
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {goals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      id={goal.id}
                      title={goal.title}
                      whyItMatters={goal.why_it_matters}
                      momentum={goal.momentum}
                      linkedTaskCount={taskCountByGoalId[goal.id] ?? 0}
                      href={`/goals/${goal.id}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Uncategorized column */}
        {(uncategorizedGoals.length > 0 || areas.length === 0) && (
          <div className="flex-shrink-0 w-72">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-400">Uncategorized</h2>
              <span className="text-xs text-gray-600">{uncategorizedGoals.length}</span>
            </div>

            {uncategorizedGoals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center">
                <p className="text-xs text-gray-600 mb-2">No goals yet</p>
                <Link
                  href="/"
                  className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                >
                  Add a goal via chat
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {uncategorizedGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    id={goal.id}
                    title={goal.title}
                    whyItMatters={goal.why_it_matters}
                    momentum={goal.momentum}
                    linkedTaskCount={taskCountByGoalId[goal.id] ?? 0}
                    href={`/goals/${goal.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state when no life areas and no goals */}
        {areas.length === 0 && uncategorizedGoals.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-gray-500 mb-2">No life areas or goals yet.</p>
            <Link
              href="/"
              className="text-sm text-blue-500 hover:text-blue-400 transition-colors"
            >
              Create your first goal via chat
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
