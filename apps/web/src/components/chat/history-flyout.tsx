'use client'

// History flyout — Task 9.1.2.4.1
// Fills the 9.1.1 flyout stub. Lists server-side conversations from
// listConversations(), search-filterable, timezone-correct relative times.

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from 'react'
import { listConversations } from '@/app/actions/chat'
import { useActiveConversation } from '@/components/providers/conversation-provider'
import { useTimezone } from '@/components/providers/timezone-provider'
import { formatInTimezone } from '@/lib/utils/timezone'
import type { ConversationSummary } from '@/app/actions/chat'

// ---------------------------------------------------------------------------
// Relative time helper — "Today", "Yesterday", or formatted date+time
// ---------------------------------------------------------------------------
function relativeTime(isoString: string, timezone: string): string {
  const now = new Date()

  // Compare calendar dates in the user's timezone
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(isoString),
  )

  if (dateStr === todayStr) {
    return (
      'Today · ' +
      formatInTimezone(isoString, timezone, { hour: '2-digit', minute: '2-digit' })
    )
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(yesterday)
  if (dateStr === yesterdayStr) {
    return (
      'Yesterday · ' +
      formatInTimezone(isoString, timezone, { hour: '2-digit', minute: '2-digit' })
    )
  }

  return formatInTimezone(isoString, timezone, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Skeleton row (quiet loading state)
// ---------------------------------------------------------------------------
function SkeletonRow() {
  return (
    <div className="px-2 py-2 rounded-md" aria-hidden>
      <div className="h-3 w-3/4 rounded bg-gray-800 motion-safe:animate-pulse mb-1.5" />
      <div className="h-2 w-1/2 rounded bg-gray-800/60 motion-safe:animate-pulse" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface HistoryFlyoutProps {
  onClose: () => void
}

// ---------------------------------------------------------------------------
// HistoryFlyout
// ---------------------------------------------------------------------------
export function HistoryFlyout({ onClose }: HistoryFlyoutProps) {
  const { activeConversationId, setActiveConversation } = useActiveConversation()
  const timezone = useTimezone()

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [query, setQuery] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // ---------------------------------------------------------------------------
  // Load conversations on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    listConversations().then(data => {
      if (!cancelled) {
        setConversations(data)
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Focus search input on open
  // ---------------------------------------------------------------------------
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // ---------------------------------------------------------------------------
  // Esc closes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ---------------------------------------------------------------------------
  // Focus trap — Tab / Shift+Tab cycle within the dialog
  // ---------------------------------------------------------------------------
  const handleDialogKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [],
  )

  // ---------------------------------------------------------------------------
  // Filtered list
  // ---------------------------------------------------------------------------
  const filtered = query.trim()
    ? conversations.filter(c =>
        (c.title ?? '').toLowerCase().includes(query.trim().toLowerCase()),
      )
    : conversations

  // ---------------------------------------------------------------------------
  // Select a conversation
  // ---------------------------------------------------------------------------
  function handleSelect(id: string) {
    setActiveConversation(id)
    onClose()
  }

  // ---------------------------------------------------------------------------
  // Keyboard nav in list: Arrow keys
  // ---------------------------------------------------------------------------
  function handleListKeyDown(e: KeyboardEvent<HTMLElement>, index: number) {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll<HTMLElement>('[role="option"]')
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[Math.min(index + 1, items.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (index === 0) {
        searchRef.current?.focus()
      } else {
        items[index - 1]?.focus()
      }
    }
  }

  // Move focus from search input into the list on ArrowDown
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const first = listRef.current?.querySelector<HTMLElement>('[role="option"]')
      first?.focus()
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Backdrop — outside-click closes */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden
        onClick={onClose}
      />

      {/* Flyout panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversation history"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={[
          'fixed left-14 top-4 z-50 w-80',
          'rounded-lg border border-gray-700 bg-gray-900 shadow-xl',
          'flex flex-col focus:outline-none',
          'max-h-[calc(100vh-2rem)]',
        ].join(' ')}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-800">
          <span className="font-medium text-sm text-gray-100">Conversation history</span>
          <button
            type="button"
            aria-label="Close history"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 py-2 border-b border-gray-800/60">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search conversations…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search conversations"
            className={[
              'w-full rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600',
              'border border-gray-700 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600',
            ].join(' ')}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1" role="presentation">
          {isLoading ? (
            <div
              role="status"
              aria-label="Loading conversations"
              className="px-2 py-1 space-y-1"
            >
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : conversations.length === 0 ? (
            /* First-run empty state — brand-new user */
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400 font-medium mb-1">No conversations yet</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Click <strong className="text-gray-400">New chat</strong> in the rail to start
                your first conversation.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            /* No search results */
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400 font-medium mb-1">No results</p>
              <p className="text-xs text-gray-600">
                Try a different search term.
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Conversations"
              className="space-y-0.5 px-1"
            >
              {filtered.map((conv, index) => {
                const isActive = conv.id === activeConversationId
                return (
                  <li key={conv.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      tabIndex={index === 0 ? 0 : -1}
                      onClick={() => handleSelect(conv.id)}
                      onKeyDown={e => handleListKeyDown(e, index)}
                      className={[
                        'w-full text-left rounded-md px-3 py-2 transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                        isActive
                          ? 'bg-emerald-900/40 text-white'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100',
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-2">
                        {isActive && (
                          <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400"
                            aria-hidden
                          />
                        )}
                        <span className="truncate text-sm font-medium leading-tight">
                          {conv.title ?? 'New conversation'}
                        </span>
                      </span>
                      <span className="block text-xs text-gray-600 mt-0.5 truncate">
                        {relativeTime(conv.updated_at, timezone)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
