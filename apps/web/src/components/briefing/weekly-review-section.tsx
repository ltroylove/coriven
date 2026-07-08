/**
 * WeeklyReviewSection component (Wave 7.3.1, Task 7.3.1.3.1)
 *
 * Renders a structured weekly review below the standard daily briefing sections.
 * Present only when weekly review data exists for the current ISO week.
 *
 * Accessibility: WCAG 2.1 AA
 *   - h2 for "Weekly Review" section heading
 *   - h3 for each subsection (Wins, Blockers, Next Week)
 *   - ul with aria-label for each list
 *   - narrative shown as <blockquote> (secondary, not primary heading)
 *   - keyboard navigable (semantic HTML; no custom focus traps needed)
 */

import type { WeeklyReviewContent } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WeeklyReviewSectionProps {
  wins: WeeklyReviewContent['wins']
  blockers: WeeklyReviewContent['blockers']
  nextWeek: WeeklyReviewContent['nextWeek']
  narrative?: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WinsSubsection({ wins }: { wins: WeeklyReviewSectionProps['wins'] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-2">
        Wins
      </h3>
      {wins.length === 0 ? (
        <p className="text-sm text-gray-500">No completed tasks this week.</p>
      ) : (
        <ul className="space-y-1" aria-label="This week's wins">
          {wins.map((win) => (
            <li
              key={win.taskId}
              className="flex items-start gap-2 text-sm"
            >
              <span className="mt-0.5 text-emerald-500 shrink-0" aria-hidden="true">
                ✓
              </span>
              <span className="text-gray-200">
                {win.title}
                {win.goalTitle && (
                  <span className="ml-2 text-xs text-gray-500">({win.goalTitle})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BlockersSubsection({ blockers }: { blockers: WeeklyReviewSectionProps['blockers'] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-2">
        Blockers
      </h3>
      {blockers.length === 0 ? (
        <p className="text-sm text-gray-500">No blockers — clean slate.</p>
      ) : (
        <ul className="space-y-1" aria-label="Blockers and overdue items">
          {blockers.map((blocker, idx) => (
            <li
              // eslint-disable-next-line react/no-array-index-key
              key={`${blocker.type}-${idx}`}
              className="flex items-start gap-2 text-sm"
            >
              <span
                className="mt-0.5 shrink-0 text-amber-500"
                aria-hidden="true"
              >
                {blocker.type === 'overdue_task' ? '!' : '↓'}
              </span>
              <span className="text-gray-200">
                {blocker.title}
                <span className="ml-2 text-xs text-gray-500">{blocker.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NextWeekSubsection({ nextWeek }: { nextWeek: WeeklyReviewSectionProps['nextWeek'] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">
        Next-Week Focus
      </h3>
      {nextWeek.length === 0 ? (
        <p className="text-sm text-gray-500">No high-priority tasks due next week.</p>
      ) : (
        <ul className="space-y-1" aria-label="Next-week focus tasks">
          {nextWeek.map((task) => {
            const due = new Date(task.dueAt)
            const formattedDue = due.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
            return (
              <li
                key={task.taskId}
                className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2"
              >
                <span className="text-sm text-gray-200">{task.title}</span>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      task.priority === 'urgent'
                        ? 'bg-red-900/50 text-red-400'
                        : 'bg-blue-900/50 text-blue-400'
                    }`}
                  >
                    {task.priority}
                  </span>
                  <span className="text-xs text-gray-500">{formattedDue}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WeeklyReviewSection({
  wins,
  blockers,
  nextWeek,
  narrative,
  generatedAt,
}: WeeklyReviewSectionProps) {
  const generatedDate = new Date(generatedAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <section aria-labelledby="weekly-review-heading" className="max-w-xl">
      <div className="mb-4">
        <h2
          id="weekly-review-heading"
          className="text-xs font-semibold uppercase tracking-wider text-gray-400"
        >
          Weekly Review
        </h2>
        <p className="text-xs text-gray-600 mt-0.5">Generated {generatedDate}</p>
      </div>

      {/* Narrative paragraph (additive only — secondary to structured lists) */}
      {narrative && (
        <blockquote className="border-l-2 border-gray-700 pl-3 mb-6 text-sm text-gray-400 italic">
          {narrative}
        </blockquote>
      )}

      <div className="space-y-6">
        <WinsSubsection wins={wins} />
        <BlockersSubsection blockers={blockers} />
        <NextWeekSubsection nextWeek={nextWeek} />
      </div>
    </section>
  )
}
