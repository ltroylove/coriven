// @vitest-environment jsdom
//
// Integration test — Task 9.1.2.4.2
// Verifies: one conversation state across surfaces; switch/new/reload continuity;
// the split-brain repro case is impossible.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('@/app/actions/chat', () => ({
  listConversations: vi.fn(),
  getChatHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('lucide-react', () => ({
  MessageSquare: () => null,
  History: () => null,
  Plus: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Zap: () => null,
  CheckCircle2: () => null,
  XCircle: () => null,
  ArrowUp: () => null,
  Square: () => null,
}))

// Stub composer so we don't need to set up all its deps
vi.mock('@/components/chat/composer', () => ({
  Composer: ({ onSend }: { onSend: (t: string) => void }) => (
    <button data-testid="send" onClick={() => onSend('Hello')}>Send</button>
  ),
}))

import { listConversations } from '@/app/actions/chat'
import {
  ConversationProvider,
  useActiveConversation,
  ACTIVE_CONV_KEY,
} from '@/components/providers/conversation-provider'
import { TimezoneProvider } from '@/components/providers/timezone-provider'
import { HistoryFlyout } from '../history-flyout'
import type { ConversationSummary } from '@/app/actions/chat'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListConversations = vi.mocked(listConversations)

function makeConv(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: crypto.randomUUID(),
    title: 'A conversation',
    updated_at: new Date().toISOString(),
    pinned_at: null,
    ...overrides,
  }
}

/** Reads the active conversation id from context — used in test assertions. */
function ActiveIdDisplay() {
  const { activeConversationId, newConversation, setActiveConversation } =
    useActiveConversation()
  return (
    <div>
      <span data-testid="active">{activeConversationId}</span>
      <button data-testid="new-btn" onClick={newConversation}>New</button>
      <button
        data-testid="set-btn"
        onClick={() => setActiveConversation('switch-target-id')}
      >
        Switch
      </button>
    </div>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TimezoneProvider timezone="UTC">
      <ConversationProvider>
        {children}
      </ConversationProvider>
    </TimezoneProvider>
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Cross-surface single store
// ---------------------------------------------------------------------------
describe('Conversation unification — single store', () => {
  it('New chat generates a UUID that is shared by all consumers', async () => {
    render(
      <Wrapper>
        <ActiveIdDisplay />
      </Wrapper>,
    )

    // Wait for provider to hydrate
    await waitFor(() => {
      const id = screen.getByTestId('active').textContent ?? ''
      expect(id.length).toBeGreaterThan(0)
    })

    const before = screen.getByTestId('active').textContent

    await act(async () => {
      screen.getByTestId('new-btn').click()
    })

    const after = screen.getByTestId('active').textContent
    expect(after).not.toBe(before)
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe(after)
  })

  it('setActiveConversation switches store and persists', async () => {
    render(
      <Wrapper>
        <ActiveIdDisplay />
      </Wrapper>,
    )

    await waitFor(() => {
      const id = screen.getByTestId('active').textContent ?? ''
      expect(id.length).toBeGreaterThan(0)
    })

    await act(async () => {
      screen.getByTestId('set-btn').click()
    })

    expect(screen.getByTestId('active').textContent).toBe('switch-target-id')
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('switch-target-id')
  })

  it('reload reuses the persisted active conversation id', async () => {
    localStorage.setItem(ACTIVE_CONV_KEY, 'persisted-conv-id')

    render(
      <Wrapper>
        <ActiveIdDisplay />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active').textContent).toBe('persisted-conv-id')
    })
  })
})

// ---------------------------------------------------------------------------
// History flyout — select switches the shared store
// ---------------------------------------------------------------------------
describe('Conversation unification — flyout select updates store', () => {
  it('selecting a conversation in the flyout updates the shared active id', async () => {
    const conv = makeConv({ id: 'flyout-selected-id', title: 'Thread from flyout' })
    mockListConversations.mockResolvedValue([conv])

    const onClose = vi.fn()
    render(
      <Wrapper>
        <ActiveIdDisplay />
        <HistoryFlyout onClose={onClose} />
      </Wrapper>,
    )

    // Wait for flyout to load
    await waitFor(() => {
      expect(screen.getByText('Thread from flyout')).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByText('Thread from flyout').click()
    })

    // The shared store must reflect the selected conversation
    expect(screen.getByTestId('active').textContent).toBe('flyout-selected-id')
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('flyout-selected-id')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Split-brain regression
// ---------------------------------------------------------------------------
describe('Split-brain repro — "ask on /chat, navigate, chat has no memory"', () => {
  it('the active conversation id is the same before and after a simulated navigation', async () => {
    // The split brain was: panel and /chat route used different localStorage keys.
    // Post-unification: there is exactly ONE key; both surfaces read the same id.
    // This test proves neither the old panel key nor tab key can diverge.

    // Simulate: user had a panel conversation
    localStorage.setItem(ACTIVE_CONV_KEY, 'unified-conv-id')

    const { unmount } = render(
      <Wrapper>
        <ActiveIdDisplay />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active').textContent).toBe('unified-conv-id')
    })

    // Simulate navigation: unmount + remount (same provider state, because
    // the key is in localStorage and picked up on re-mount)
    // In the real app the ConversationProvider lives outside the page router
    // so remounting is not needed — but we simulate it for completeness.
    unmount()

    render(
      <Wrapper>
        <ActiveIdDisplay />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active').textContent).toBe('unified-conv-id')
    })

    // Verify neither legacy key has been re-written
    expect(localStorage.getItem('chat-panel-conversation-id')).toBeNull()
    expect(localStorage.getItem('chat-tab-active-id')).toBeNull()
  })
})
