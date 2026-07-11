'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, History } from 'lucide-react'
import { signOut } from '@/app/(auth)/signin/actions'
import { usePanel } from '@/components/providers/panel-provider'
import { SURFACE_REGISTRY } from '@/lib/surfaces/registry'
import type { SurfaceId } from '@/lib/surfaces/registry'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PANEL_CONV_KEY = 'chat-panel-conversation-id'

// Rail-visible surfaces from the registry (declaration order = rail order)
const RAIL_SURFACES = SURFACE_REGISTRY.filter((e) => e.rail)

// ---------------------------------------------------------------------------
// Tooltip wrapper
// ---------------------------------------------------------------------------
function RailTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="relative group">
      {children}
      <span
        role="tooltip"
        className={[
          'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50',
          'whitespace-nowrap rounded px-2 py-1 text-xs',
          'bg-gray-800 text-gray-100 border border-gray-700',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          'motion-safe:transition-opacity motion-safe:duration-150',
        ].join(' ')}
      >
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rail button (icon button with active state + tooltip)
// ---------------------------------------------------------------------------
function RailButton({
  label,
  icon: Icon,
  isActive,
  onClick,
  'aria-current': ariaCurrent,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
  isActive?: boolean
  onClick: () => void
  'aria-current'?: 'page' | undefined
}) {
  return (
    <RailTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-current={ariaCurrent}
        onClick={onClick}
        className={[
          'flex items-center justify-center w-10 h-10 rounded-lg',
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
          isActive
            ? 'bg-emerald-900/60 text-emerald-400'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100',
        ].join(' ')}
      >
        <Icon size={20} aria-hidden />
        {isActive && (
          <span className="sr-only">(current)</span>
        )}
      </button>
    </RailTooltip>
  )
}

// ---------------------------------------------------------------------------
// History flyout placeholder (focus-trapped, Esc closes)
// ---------------------------------------------------------------------------
function HistoryFlyout({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus the dialog on open
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Esc closes
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
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
        className={[
          'fixed left-14 top-4 z-50 w-72',
          'rounded-lg border border-gray-700 bg-gray-900 shadow-xl',
          'p-4 text-sm text-gray-300 focus:outline-none',
        ].join(' ')}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-gray-100">Conversation history</span>
          <button
            type="button"
            aria-label="Close history"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <p className="text-gray-500 text-xs leading-relaxed">
          {/* TODO(9.1.2): Replace with real conversation list from server-side conversations (C1). */}
          Conversation history arrives with server-side conversations.
        </p>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------
interface RailProps {
  userEmail: string
  /** React key for the ChatPane — increment to remount (new chat) */
  onNewChat: () => void
}

export function Rail({ userEmail, onNewChat }: RailProps) {
  const { openSurface, openPanel } = usePanel()
  const [historyOpen, setHistoryOpen] = useState(false)

  const handleNavClick = useCallback(
    (surface: SurfaceId) => {
      openPanel(surface)
    },
    [openPanel],
  )

  const handleNewChat = useCallback(() => {
    // TODO(9.1.2): rewire to unified conversation store (C1)
    const newId = crypto.randomUUID()
    localStorage.setItem(PANEL_CONV_KEY, newId)
    onNewChat()
  }, [onNewChat])

  // Middle group: rail-visible surfaces EXCEPT settings (goes to bottom)
  const middleSurfaces = RAIL_SURFACES.filter((e) => e.surface !== 'settings')
  const settingsEntry = SURFACE_REGISTRY.find((e) => e.surface === 'settings')!

  return (
    <nav
      aria-label="Main navigation"
      className={[
        'flex flex-col items-center shrink-0 w-14 h-full',
        'border-r border-gray-800 bg-gray-950 py-3 gap-1',
      ].join(' ')}
    >
      {/* ── TOP GROUP ─────────────────────────────────────────── */}
      {/* Coriven mark */}
      <div className="flex items-center justify-center w-10 h-10 mb-1">
        <span
          className="font-bold text-base text-emerald-400 select-none"
          aria-label="Coriven"
          title="Coriven"
        >
          C
        </span>
      </div>

      {/* New chat */}
      <RailTooltip label="New chat">
        <button
          type="button"
          aria-label="New chat"
          onClick={handleNewChat}
          className={[
            'flex items-center justify-center w-10 h-10 rounded-lg',
            'text-gray-400 hover:bg-gray-800 hover:text-gray-100',
            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
          ].join(' ')}
        >
          <MessageSquare size={20} aria-hidden />
        </button>
      </RailTooltip>

      {/* History trigger */}
      <RailTooltip label="Conversation history">
        <button
          type="button"
          aria-label="Conversation history"
          aria-haspopup="dialog"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((o) => !o)}
          className={[
            'flex items-center justify-center w-10 h-10 rounded-lg',
            'text-gray-400 hover:bg-gray-800 hover:text-gray-100',
            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
          ].join(' ')}
        >
          <History size={20} aria-hidden />
        </button>
      </RailTooltip>

      {historyOpen && <HistoryFlyout onClose={() => setHistoryOpen(false)} />}

      {/* Divider */}
      <div className="w-8 h-px bg-gray-800 my-1" aria-hidden />

      {/* ── MIDDLE GROUP — generated from registry ───────────── */}
      {middleSurfaces.map((entry) => {
        const isActive = openSurface === entry.surface
        return (
          <RailButton
            key={entry.surface}
            label={entry.label}
            icon={entry.icon}
            isActive={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => handleNavClick(entry.surface)}
          />
        )
      })}

      {/* Spacer pushes bottom group to the bottom */}
      <div className="flex-1" aria-hidden />

      {/* ── BOTTOM GROUP ─────────────────────────────────────── */}
      {/* Settings */}
      <RailButton
        label={settingsEntry.label}
        icon={settingsEntry.icon}
        isActive={openSurface === 'settings'}
        aria-current={openSurface === 'settings' ? 'page' : undefined}
        onClick={() => handleNavClick('settings')}
      />

      {/* Divider */}
      <div className="w-8 h-px bg-gray-800 my-1" aria-hidden />

      {/* User email + sign out */}
      <div className="flex flex-col items-center gap-1 w-full px-2">
        <RailTooltip label={userEmail}>
          <span className="text-[10px] text-gray-600 truncate max-w-[40px] block text-center leading-tight">
            {userEmail.split('@')[0]}
          </span>
        </RailTooltip>
        <form action={signOut}>
          <RailTooltip label="Sign out">
            <button
              type="submit"
              aria-label="Sign out"
              className={[
                'text-[10px] text-gray-500 hover:text-gray-200 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded',
              ].join(' ')}
            >
              out
            </button>
          </RailTooltip>
        </form>
      </div>
    </nav>
  )
}
