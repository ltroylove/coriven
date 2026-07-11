'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
/** The single C1 active-conversation key (Wave 9.1.2). */
export const ACTIVE_CONV_KEY = 'coriven-active-conversation'

/**
 * Legacy keys from before conversation unification — read once for migration,
 * then deleted. These must NOT be written anywhere after 9.1.2.
 *
 * Precedence: panel key > tab key (panel was the primary daily surface).
 */
const LEGACY_PANEL_KEY = 'chat-panel-conversation-id'
const LEGACY_TAB_KEY = 'chat-tab-active-id'

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------
export interface ConversationContextValue {
  /** The currently active conversation UUID. Always set (never null). */
  activeConversationId: string
  /**
   * Switch to an existing conversation by id. Causes ChatPane to remount
   * (via key={activeConversationId}) and load the new thread.
   */
  setActiveConversation: (id: string) => void
  /**
   * Start a fresh conversation: generates a new UUID and activates it.
   * No server row is created until the first message is sent (C1 spec).
   */
  newConversation: () => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const ConversationContext = createContext<ConversationContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Reads or initialises `coriven-active-conversation` in localStorage.
 *
 * One-time migration (only on first mount, before C1):
 *   1. Use `chat-panel-conversation-id` if present (panel was the primary surface).
 *   2. Else use `chat-tab-active-id` if present.
 *   3. Else generate a new UUID.
 * Both legacy keys are deleted regardless of which branch runs.
 *
 * Called only inside useEffect (client-only) to avoid hydration mismatches.
 */
function resolveInitialId(): string {
  // If the unified key already exists, use it — migration already ran.
  const existing = localStorage.getItem(ACTIVE_CONV_KEY)
  if (existing) return existing

  // One-time migration: check legacy keys in priority order.
  const panelId = localStorage.getItem(LEGACY_PANEL_KEY)
  const tabId = localStorage.getItem(LEGACY_TAB_KEY)

  const adopted = panelId ?? tabId ?? crypto.randomUUID()

  // Write the unified key immediately.
  localStorage.setItem(ACTIVE_CONV_KEY, adopted)

  // Delete both legacy keys unconditionally.
  localStorage.removeItem(LEGACY_PANEL_KEY)
  localStorage.removeItem(LEGACY_TAB_KEY)

  return adopted
}

export function ConversationProvider({ children }: { children: ReactNode }) {
  // Start null so we never hydrate with localStorage state (avoids mismatch).
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  // Resolve (and potentially migrate) on mount, client-side only.
  useEffect(() => {
    const id = resolveInitialId()
    setActiveConversationId(id)
  }, [])

  const setActiveConversation = useCallback((id: string) => {
    setActiveConversationId(id)
    try {
      localStorage.setItem(ACTIVE_CONV_KEY, id)
    } catch {
      // localStorage unavailable — in-memory only.
    }
  }, [])

  const newConversation = useCallback(() => {
    const id = crypto.randomUUID()
    setActiveConversationId(id)
    try {
      localStorage.setItem(ACTIVE_CONV_KEY, id)
    } catch {
      // localStorage unavailable — in-memory only.
    }
  }, [])

  // Until the client effect runs, render children with a placeholder so the
  // tree can mount without errors. ChatPane guards against a null/empty convId.
  const value: ConversationContextValue = {
    activeConversationId: activeConversationId ?? '',
    setActiveConversation,
    newConversation,
  }

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useActiveConversation(): ConversationContextValue {
  const ctx = useContext(ConversationContext)
  if (!ctx) {
    throw new Error('useActiveConversation must be used within a ConversationProvider')
  }
  return ctx
}
