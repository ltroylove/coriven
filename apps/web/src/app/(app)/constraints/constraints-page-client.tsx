'use client'

import { useState } from 'react'
import type { BehavioralConstraint } from '@personal-assistant/types'
import { ConstraintRow } from '@/components/constraints/constraint-row'
import { ConstraintForm } from '@/components/constraints/constraint-form'
import { addConstraintAction, removeConstraintAction, lockConstraintAction } from '@/app/actions/constraints'

type Tab = 'all' | 'locked' | 'unlocked'

export function ConstraintsPageClient({ constraints: initial }: { constraints: BehavioralConstraint[] }) {
  const [constraints, setConstraints] = useState(initial)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  function refresh() {
    // revalidatePath in the Server Action handles the actual refresh;
    // this optimistically resets local search/tab state
    setSearch('')
  }

  const visible = constraints.filter(c => {
    if (tab === 'locked' && !c.is_locked) return false
    if (tab === 'unlocked' && c.is_locked) return false
    if (search) {
      const q = search.toLowerCase()
      return c.rule.toLowerCase().includes(q) || c.rationale.toLowerCase().includes(q)
    }
    return true
  })

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'locked', label: 'Locked' },
    { key: 'unlocked', label: 'Unlocked' },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Constraints</h1>

      <ConstraintForm onAdd={addConstraintAction} onAdded={refresh} />

      <div className="space-y-4">
        <div className="flex items-center gap-4 border-b border-gray-800">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2 text-sm transition-colors ${
                tab === t.key
                  ? 'text-white border-b-2 border-blue-500 -mb-px'
                  : 'text-gray-400 hover:text-white'
              }`}
              aria-current={tab === t.key ? 'true' : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rules…"
          aria-label="Search constraints"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {visible.length === 0 ? (
          <p className="text-sm text-gray-500">
            {constraints.length === 0
              ? 'No constraints yet — add one above or ask Coriven in chat to set a rule for you.'
              : 'No constraints match your filter.'}
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Constraint list" aria-live="polite">
            {visible.map(c => (
              <ConstraintRow
                key={c.id}
                constraint={c}
                onRemove={removeConstraintAction}
                onLock={lockConstraintAction}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
