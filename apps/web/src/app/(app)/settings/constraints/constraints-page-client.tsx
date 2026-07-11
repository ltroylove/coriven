'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { BehavioralConstraint } from '@personal-assistant/types'
import { ConstraintRow } from '@/components/constraints/constraint-row'
import { ConstraintForm } from '@/components/constraints/constraint-form'
import { addConstraintAction, removeConstraintAction, lockConstraintAction } from '@/app/actions/constraints'

type Tab = 'all' | 'locked' | 'unlocked'

export function ConstraintsPageClient({ constraints: serverConstraints }: { constraints: BehavioralConstraint[] }) {
  const router = useRouter()
  const [constraints, setConstraints] = useState(serverConstraints)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  // Sync local state when server re-renders with fresh data after revalidatePath
  useEffect(() => { setConstraints(serverConstraints) }, [serverConstraints])

  function refresh() {
    router.refresh()
    setSearch('')
  }

  async function handleRemove(id: string) {
    const result = await removeConstraintAction(id)
    if (!result.error) {
      setConstraints(cs => cs.filter(c => c.id !== id))
      router.refresh()
    }
    return result
  }

  async function handleLock(id: string) {
    const result = await lockConstraintAction(id)
    if (!result.error) {
      setConstraints(cs => cs.map(c => c.id === id ? { ...c, is_locked: true } : c))
      router.refresh()
    }
    return result
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
                onRemove={handleRemove}
                onLock={handleLock}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
